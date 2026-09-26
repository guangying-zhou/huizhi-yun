import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const table = 'aims_work_item_completion_requests'
const view = 'work_item_completion_requests'
const columnDefinition = "enum('target','matter')"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function identifier(value) {
  assert(/^[a-z][a-z0-9_]{0,63}$/.test(value), 'unexpected database identifier')
  return `\`${value}\``
}
// Match Runtime's viewCanonical token rules: keywords fold, quoted identifiers do not.
function canonical(definition) {
  const tokens = definition.match(/`(?:``|[^`])*`|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9]*|\S/g) || []
  return tokens.map(token => /^[A-Za-z_]/.test(token) ? token.toLowerCase() : token).join('\0')
}
function viewDefinition(database, columns) {
  const source = `${identifier(database)}.${identifier(table)}`
  return `SELECT ${columns.map(column => `${source}.${identifier(column)} AS ${identifier(column)}`).join(',')} FROM ${source}`
}
async function viewState(db, database, physicalColumns) {
  const [objects] = await db.execute(`SELECT t.TABLE_TYPE,v.VIEW_DEFINITION,v.SECURITY_TYPE,v.IS_UPDATABLE,v.CHECK_OPTION
    FROM information_schema.TABLES t LEFT JOIN information_schema.VIEWS v
      ON v.TABLE_SCHEMA=t.TABLE_SCHEMA AND v.TABLE_NAME=t.TABLE_NAME
    WHERE t.TABLE_SCHEMA=? AND t.TABLE_NAME=?`, [database, view])
  assert(objects.length === 1 && objects[0].TABLE_TYPE === 'VIEW', 'completion compatibility view missing or replaced')
  const [viewColumns] = await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [database, view])
  const names = viewColumns.map(row => row.COLUMN_NAME)
  const legacy = physicalColumns.filter(name => name !== 'kind')
  const expected = names.length === legacy.length ? legacy : physicalColumns
  assert(JSON.stringify(names) === JSON.stringify(expected), 'completion compatibility view columns drifted')
  const metadata = objects[0]
  assert(metadata.SECURITY_TYPE === 'INVOKER' && metadata.IS_UPDATABLE === 'YES'
    && metadata.CHECK_OPTION === 'NONE' && canonical(metadata.VIEW_DEFINITION) === canonical(viewDefinition(database, expected)),
  'completion compatibility view definition drifted')
  return { status: physicalColumns.includes('kind') && names.length === physicalColumns.length ? 'current' : 'legacy', columns: names }
}

export async function planAimsCompletionKind(db) {
  const [[{ database }]] = await db.query('SELECT DATABASE() AS `database`')
  identifier(database)
  const [columns] = await db.execute(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='kind'`, [database, table])
  assert(columns.length <= 1, 'unexpected completion kind column')
  const kind = columns[0] || null
  if (kind) {
    assert(kind.COLUMN_TYPE.toLowerCase() === columnDefinition && kind.IS_NULLABLE === 'NO'
      && kind.COLUMN_DEFAULT === 'target', 'unsupported completion kind column')
  }
  const [physicalRows] = await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [database, table])
  const physicalColumns = physicalRows.map(row => row.COLUMN_NAME)
  assert(physicalColumns.length === (kind ? 16 : 15), 'unexpected completion physical columns')
  const compatibilityView = await viewState(db, database, physicalColumns)
  const [rows] = await db.query(`SELECT id,project_id,work_item_id,requested_by,
    CAST(snapshot_json AS CHAR) AS snapshot_json,snapshot_sha256,review_version,status,
    workflow_instance_id,workflow_instance_no,target_receipt_id,operation_key,
    created_at,updated_at${kind ? ',kind' : ''}
    FROM ${table} ORDER BY id`)
  const targets = rows.map((row) => {
    if (kind) assert(['target', 'matter'].includes(row.kind), 'unknown completion request kind')
    const { kind: _kind, ...legacy } = row
    return legacy
  })
  return {
    database, column: kind ? 'installed' : 'missing', compatibilityView: compatibilityView.status,
    physicalColumns, viewColumns: compatibilityView.columns, rowCount: rows.length,
    legacyRowsHash: digest(targets), targetRows: kind ? rows.filter(row => row.kind === 'target').length : rows.length,
    matterRows: kind ? rows.filter(row => row.kind === 'matter').length : 0
  }
}

export async function applyAimsCompletionKind(db, approvedHash) {
  assert(/^[a-f0-9]{64}$/.test(approvedHash || ''), 'review hash required')
  const [[{ locked }]] = await db.query("SELECT GET_LOCK(CONCAT('hzy-completion-kind:',LEFT(SHA2(DATABASE(),256),40)),30) AS locked")
  assert(locked === 1, 'completion migration lock unavailable')
  try {
    const before = await planAimsCompletionKind(db)
    assert(digest(before) === approvedHash, 'completion migration plan changed')
    if (before.column === 'missing') {
      await db.query(`ALTER TABLE ${table} ADD COLUMN kind ENUM('target','matter') NOT NULL DEFAULT 'target' AFTER work_item_id`)
    }
    const [physicalRows] = await db.execute(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [before.database, table])
    const physicalColumns = physicalRows.map(row => row.COLUMN_NAME)
    const existing = await viewState(db, before.database, physicalColumns)
    if (existing.status === 'legacy') {
      await db.query(`CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW
        ${identifier(before.database)}.${identifier(view)} AS ${viewDefinition(before.database, physicalColumns)}`)
    }
    const after = await planAimsCompletionKind(db)
    assert(after.column === 'installed' && after.compatibilityView === 'current'
      && after.viewColumns.length === 16 && after.viewColumns.includes('kind')
      && after.rowCount === before.rowCount
      && after.legacyRowsHash === before.legacyRowsHash
      && (before.column !== 'missing' || after.targetRows === before.rowCount),
    'completion migration changed existing requests')
    return after
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT('hzy-completion-kind:',LEFT(SHA2(DATABASE(),256),40)))")
  }
}

async function main() {
  const args = process.argv.slice(2)
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const configPath = option('--config'), tenant = option('--tenant'), database = option('--database')
  assert(configPath && tenant && database, '--config, --tenant, and --database required')
  identifier(database)
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
    const planned = await planAimsCompletionKind(db)
    const reviewHash = digest({ identity, schemaHash: digest(planned) })
    if (applying) assert(option('--review-hash') === reviewHash, 'tenant-bound review hash changed')
    const result = applying ? await applyAimsCompletionKind(db, digest(planned)) : planned
    console.log(JSON.stringify({ ...identity, column: result.column, rowCount: result.rowCount,
      targetRows: result.targetRows, matterRows: result.matterRows, legacyRowsHash: result.legacyRowsHash,
      compatibilityView: result.compatibilityView, viewColumns: result.viewColumns.length,
      reviewHash, mode: applying ? 'applied' : 'plan' }, null, 2))
  } finally {
    await db.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Completion kind migration stopped: ${error.code ?? error.message}`); process.exitCode = 1 })
}
