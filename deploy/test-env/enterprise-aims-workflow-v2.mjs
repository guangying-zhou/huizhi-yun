import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const transitionTable = 'aims_workflow_transitions'
const statusTable = 'aims_workflow_status_catalog'
const oldType = "enum('project','milestone','requirement','task','bug')"
const newType = "enum('project','milestone','requirement','task','bug','target','matter')"
const statuses = [
  ['target', 'planning', 1, 0, 10], ['target', 'todo', 0, 0, 20],
  ['target', 'in_progress', 0, 0, 30], ['target', 'in_review', 0, 0, 40],
  ['target', 'completed', 0, 1, 50], ['matter', 'todo', 1, 0, 10],
  ['matter', 'in_progress', 0, 0, 20], ['matter', 'in_review', 0, 0, 30],
  ['matter', 'completed', 0, 1, 40]
]
// V2 status-model migration plus v2.3 reset, without rewriting legacy rows.
const transitions = [
  ['target', 'planning', 'todo', 'decompose'],
  ['target', 'todo', 'in_progress', 'start'],
  ['target', 'in_progress', 'todo', 'reset'],
  ['target', 'in_progress', 'in_review', 'submit'],
  ['target', 'in_review', 'completed', 'approve'],
  ['target', 'in_review', 'in_progress', 'reject'],
  ['target', 'completed', 'in_progress', 'reopen'],
  ['matter', 'todo', 'in_progress', 'start'],
  ['matter', 'in_progress', 'todo', 'reset'],
  ['matter', 'in_progress', 'in_review', 'submit'],
  ['matter', 'in_review', 'completed', 'approve'],
  ['matter', 'in_review', 'in_progress', 'reject'],
  ['matter', 'completed', 'in_progress', 'reopen']
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function identifier(value) {
  assert(/^[a-z][a-z0-9_]{0,63}$/.test(value), 'unexpected workflow identifier')
  return `\`${value}\``
}

async function readState(db) {
  const [[{ database }]] = await db.query('SELECT DATABASE() AS `database`')
  assert(database && /^[a-z][a-z0-9_]{0,63}$/.test(database), 'explicit unified database required')
  const [columns] = await db.execute(`SELECT TABLE_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?) AND COLUMN_NAME='entity_type'`, [database, statusTable, transitionTable])
  const types = Object.fromEntries(columns.map(row => [row.TABLE_NAME, row.COLUMN_TYPE.toLowerCase()]))
  assert([oldType, newType].includes(types[statusTable]) && [oldType, newType].includes(types[transitionTable]), 'unsupported workflow column type')
  assert(types[statusTable] === types[transitionTable], 'partial workflow column migration needs recovery')
  const [keys] = await db.execute(`SELECT CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME=?
    ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION`, [database, transitionTable, statusTable])
  const groups = new Map()
  for (const key of keys) {
    const columns = groups.get(key.CONSTRAINT_NAME) ?? []
    columns.push([key.COLUMN_NAME, key.REFERENCED_COLUMN_NAME])
    groups.set(key.CONSTRAINT_NAME, columns)
  }
  const findKey = column => [...groups].filter(([, cols]) =>
    cols.length === 2 && cols.some(([source, target]) => source === 'entity_type' && target === 'entity_type') &&
    cols.some(([source, target]) => source === column && target === 'status'))
  const from = findKey('from_status'), to = findKey('to_status')
  assert(groups.size === 2 && from.length === 1 && to.length === 1 && from[0][0] !== to[0][0], 'unexpected workflow foreign keys')
  const foreignKeys = [from[0][0], to[0][0]]
  foreignKeys.forEach(identifier)
  const [oldStatuses] = await db.query(`SELECT * FROM ${statusTable} WHERE entity_type NOT IN ('target','matter') ORDER BY entity_type,status`)
  const [oldTransitions] = await db.query(`SELECT * FROM ${transitionTable} WHERE entity_type NOT IN ('target','matter') ORDER BY id`)
  const [newStatuses] = await db.query(`SELECT entity_type,status,is_initial,is_terminal,sort_order FROM ${statusTable} WHERE entity_type IN ('target','matter')`)
  const [newTransitions] = await db.query(`SELECT entity_type,from_status,to_status,transition_key FROM ${transitionTable} WHERE project_id IS NULL AND entity_type IN ('target','matter')`)
  for (const row of newStatuses) {
    const expected = statuses.find(s => s[0] === row.entity_type && s[1] === row.status)
    assert(expected && expected.every((field, i) => String(field) === String([
      row.entity_type, row.status, row.is_initial, row.is_terminal, row.sort_order
    ][i])), 'unexpected V2 status row')
  }
  for (const row of newTransitions) {
    assert(transitions.some(t => t.every((field, i) => field === [
      row.entity_type, row.from_status, row.to_status, row.transition_key
    ][i])), 'unexpected V2 transition row')
  }
  const presentStatuses = statuses.filter(s => newStatuses.some(r => r.entity_type === s[0] && r.status === s[1]))
  const presentTransitions = transitions.filter(t => newTransitions.some(r => t.every((field, i) => field === [
    r.entity_type, r.from_status, r.to_status, r.transition_key
  ][i])))
  assert(presentTransitions.length === newTransitions.length, 'duplicate V2 transition rows')
  return {
    database, types, foreignKeys, legacyStatusCount: oldStatuses.length, legacyTransitionCount: oldTransitions.length,
    legacyHash: digest({ oldStatuses, oldTransitions }),
    v2StatusCount: presentStatuses.length, v2TransitionCount: presentTransitions.length
  }
}

export async function planAimsWorkflowV2(db) {
  const state = await readState(db)
  return { ...state, reviewHash: digest(state), requiredStatuses: statuses.length, requiredTransitions: transitions.length }
}

export async function applyAimsWorkflowV2(db, approvedHash) {
  assert(/^[a-f0-9]{64}$/.test(approvedHash ?? ''), 'review hash required')
  const [[{ locked }]] = await db.execute("SELECT GET_LOCK(CONCAT('hzy-aims-v2:',LEFT(SHA2(DATABASE(),256),40)),30) AS locked")
  assert(locked === 1, 'workflow migration lock unavailable')
  try {
    const before = await planAimsWorkflowV2(db)
    assert(before.reviewHash === approvedHash, 'workflow migration plan changed')
    if (before.types[statusTable] === oldType) {
      const [from, to] = before.foreignKeys.map(identifier)
      await db.query(`ALTER TABLE ${transitionTable} DROP FOREIGN KEY ${from}, DROP FOREIGN KEY ${to}`)
      await db.query(`ALTER TABLE ${transitionTable} MODIFY COLUMN entity_type ENUM('project','milestone','requirement','task','bug','target','matter') NOT NULL`)
      await db.query(`ALTER TABLE ${statusTable} MODIFY COLUMN entity_type ENUM('project','milestone','requirement','task','bug','target','matter') NOT NULL`)
      await db.query(`ALTER TABLE ${transitionTable}
        ADD CONSTRAINT ${from} FOREIGN KEY (entity_type,from_status) REFERENCES ${statusTable}(entity_type,status) ON UPDATE CASCADE ON DELETE RESTRICT,
        ADD CONSTRAINT ${to} FOREIGN KEY (entity_type,to_status) REFERENCES ${statusTable}(entity_type,status) ON UPDATE CASCADE ON DELETE RESTRICT`)
    }
    for (const row of statuses) {
      await db.execute(`INSERT INTO ${statusTable}(entity_type,status,is_initial,is_terminal,sort_order)
        SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ${statusTable} WHERE entity_type=? AND status=?)`, [...row, row[0], row[1]])
    }
    for (const row of transitions) {
      await db.execute(`INSERT INTO ${transitionTable}(project_id,entity_type,from_status,to_status,transition_key)
        SELECT NULL,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ${transitionTable}
          WHERE project_id IS NULL AND entity_type=? AND from_status=? AND to_status=? AND transition_key=?)`, [...row, ...row])
    }
    const after = await planAimsWorkflowV2(db)
    assert(after.legacyHash === before.legacyHash && after.legacyStatusCount === before.legacyStatusCount && after.legacyTransitionCount === before.legacyTransitionCount,
      'legacy workflow rows changed')
    assert(after.types[statusTable] === newType && after.v2StatusCount === after.requiredStatuses && after.v2TransitionCount === after.requiredTransitions,
      'V2 workflow verification failed')
    return after
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT('hzy-aims-v2:',LEFT(SHA2(DATABASE(),256),40)))")
  }
}

async function main() {
  const args = process.argv.slice(2)
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const configPath = option('--config'), tenant = option('--tenant'), database = option('--database')
  assert(configPath && tenant && database, '--config, --tenant, and --database required')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  assert(config.tenant === tenant && config.enterprise?.db?.database === database, 'tenant/database binding mismatch')
  const identity = { tenant, deployment: config.deployment, environment: config.enterprise.environment,
    generation: config.enterprise.generation, database }
  assert(identity.deployment && identity.environment && Number.isSafeInteger(identity.generation), 'runtime binding incomplete')
  const applying = args.includes('--apply')
  let dbConfig = config.enterprise.db
  if (applying) {
    const backup = option('--backup')
    assert(backup && (await stat(backup)).isFile(), 'existing protected backup required')
    const migrationConfigPath = option('--migration-db-config')
    assert(migrationConfigPath, 'protected migration DB config required for DDL')
    const migrationConfigStat = await stat(migrationConfigPath)
    assert(migrationConfigStat.isFile() && (migrationConfigStat.mode & 0o077) === 0, 'migration DB config must be a private file')
    dbConfig = JSON.parse(await readFile(migrationConfigPath, 'utf8'))
    assert(dbConfig.database === database, 'migration database mismatch')
  }
  const db = await mysql.createConnection({ ...dbConfig, multipleStatements: false, dateStrings: true })
  try {
    const [[{ actual, instance }]] = await db.query('SELECT DATABASE() AS actual,@@server_uuid AS instance')
    assert(actual === database && instance.toLowerCase() === config.enterprise.instanceId.toLowerCase(), 'connected database/instance mismatch')
    const planned = await planAimsWorkflowV2(db)
    const reviewHash = digest({ identity, schemaHash: planned.reviewHash })
    if (applying) assert(option('--review-hash') === reviewHash, 'tenant-bound review hash changed')
    const result = applying ? await applyAimsWorkflowV2(db, planned.reviewHash) : planned
    const { legacyHash, foreignKeys, types, reviewHash: schemaHash, ...publicResult } = result
    console.log(JSON.stringify({ ...identity, ...publicResult, reviewHash, mode: applying ? 'applied' : 'plan' }, null, 2))
  } finally {
    await db.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Aims workflow migration stopped: ${error.code ?? error.message}`); process.exitCode = 1 })
}
