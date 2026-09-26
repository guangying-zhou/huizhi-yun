// Optional schema migration only. No registration, grant or exchange switch.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const root = resolve(import.meta.dirname, '..')
const specifications = {
  platform: {
    path: 'platform/docs/sql/migrations/20260926-gateway-service-keys.sql',
    tables: ['platform_gateway_keysets', 'platform_gateway_service_keys']
  },
  runtime: {
    path: 'console/docs/sql/Console-SQL-Migration-gateway-service-assertion-replay.sql',
    tables: ['gateway_service_assertion_replay']
  }
}
const hash = value => createHash('sha256').update(value).digest('hex')

export async function migrationSource(target) {
  const spec = specifications[target]
  if (!spec) throw Error('TARGET_INVALID')
  return { ...spec, sql: await readFile(resolve(root, spec.path), 'utf8') }
}

export async function inspectGatewaySchema(db, target) {
  const { tables } = await migrationSource(target)
  const result = {}
  for (const table of tables) {
    const [columns] = await db.query(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [table])
    const [indexes] = await db.query(`SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [table])
    const [constraints] = await db.query(`SELECT tc.CONSTRAINT_NAME,tc.CONSTRAINT_TYPE,tc.ENFORCED,cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc LEFT JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? ORDER BY tc.CONSTRAINT_NAME`, [table])
    const [references] = await db.query(`SELECT COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION`, [table])
    const [[engine]] = await db.query(`SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table])
    result[table] = { columns, indexes, constraints, references, engine: engine?.ENGINE ?? null }
  }
  return result
}

// The reference hashes are produced on disposable MySQL of the same version,
// from the reviewed SQL. A drifted pre-existing table is never silently reused.
export function schemaHashes(schema) {
  return Object.fromEntries(Object.entries(schema).map(([table, value]) => [table, value.columns.length ? hash(JSON.stringify(value)) : null]))
}

export async function planGatewayMigration(db, target, binding, expectedSchemaHashes) {
  const source = await migrationSource(target)
  binding = Object.fromEntries(['database', 'serverUuid', 'tenant', 'environment', 'gatewayDeployment', 'runtimeCode', 'consoleDeployment'].filter(key => binding?.[key] !== undefined).map(key => [key, binding[key]]))
  if (Object.values(binding).some(value => typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value))) throw Error('BINDING_INVALID')
  expectedSchemaHashes = Object.fromEntries(source.tables.map(table => [table, expectedSchemaHashes?.[table]]))
  const [[identity]] = await db.query('SELECT DATABASE() AS databaseName,@@server_uuid AS serverUuid,VERSION() AS mysqlVersion')
  if (identity.databaseName !== binding.database || identity.serverUuid !== binding.serverUuid || !binding.tenant || !['test', 'dev'].includes(binding.environment)) throw Error('BINDING_MISMATCH')
  if (target === 'platform') {
    const [rows] = await db.query('SELECT tenant_code,environment,status FROM deployment_sites WHERE BINARY site_code=BINARY ?', [binding.gatewayDeployment])
    if (rows.length !== 1 || rows[0].tenant_code !== binding.tenant || rows[0].environment !== binding.environment || rows[0].status !== 'active') throw Error('DEPLOYMENT_MISMATCH')
  } else if (!binding.runtimeCode || !binding.consoleDeployment) throw Error('RUNTIME_BINDING_REQUIRED')
  const schema = await inspectGatewaySchema(db, target)
  const before = schemaHashes(schema)
  for (const table of source.tables) {
    if (!/^[0-9a-f]{64}$/.test(expectedSchemaHashes?.[table] ?? '')) throw Error('REFERENCE_SCHEMA_REQUIRED')
    if (before[table] !== null && before[table] !== expectedSchemaHashes[table]) throw Error('SCHEMA_DRIFT')
  }
  const plan = { target, binding, mysqlVersion: identity.mysqlVersion, migrationSha256: hash(source.sql), before, expectedSchemaHashes }
  return { ...plan, reviewHash: hash(JSON.stringify(plan)), mutationsPerformed: false }
}

export async function verifyGatewayMigration(db, target, expectedSchemaHashes) {
  const actual = schemaHashes(await inspectGatewaySchema(db, target))
  const { tables } = await migrationSource(target)
  if (tables.some(table => !expectedSchemaHashes?.[table] || actual[table] !== expectedSchemaHashes[table])) throw Error('POST_VERIFICATION_FAILED')
  return { target, hashes: actual, verified: true, mutationsPerformed: false }
}

export async function applyGatewayMigration(db, target, binding, expectedSchemaHashes, reviewHash, backupDirectory) {
  const lockName = `hzy:gateway-schema:${target}`
  const [[lock]] = await db.query('SELECT GET_LOCK(?,0) AS acquired', [lockName])
  if (lock.acquired !== 1) throw Error('MIGRATION_LOCK_BUSY')
  try {
    const plan = await planGatewayMigration(db, target, binding, expectedSchemaHashes)
    if (plan.reviewHash !== reviewHash) throw Error('REVIEW_HASH_MISMATCH')
    // DDL is nontransactional. Back up absent/present state before creating
    // either table; rerun only the additive SQL after an interruption.
    const directory = resolve(backupDirectory, reviewHash)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const source = await migrationSource(target)
    const definitions = {}
    for (const table of source.tables) {
      if (plan.before[table] === null) definitions[table] = null
      else {
        const [[row]] = await db.query(`SHOW CREATE TABLE \`${table}\``)
        definitions[table] = row['Create Table']
      }
    }
    const backup = JSON.stringify({ plan, definitions }, null, 2)
    const backupPath = resolve(directory, 'before.json')
    try { await writeFile(backupPath, backup, { mode: 0o600, flag: 'wx' }) }
    catch (error) { if (error.code !== 'EEXIST' || await readFile(backupPath, 'utf8') !== backup) throw Error('BACKUP_CONFLICT') }
    await db.query('SET SESSION lock_wait_timeout=5')
    await db.query(source.sql)
    const verified = await verifyGatewayMigration(db, target, expectedSchemaHashes)
    const receipt = { reviewHash, target, migrationSha256: plan.migrationSha256, ...verified, mutationsPerformed: true, schemaApplied: true, businessRowsMutated: false }
    await writeFile(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
    return receipt
  } finally { await db.query('SELECT RELEASE_LOCK(?)', [lockName]) }
}

async function main() {
  const [mode = '--plan', target, configFile, reviewHash] = process.argv.slice(2)
  if (!['--plan', '--verify', '--apply'].includes(mode) || !configFile) throw Error('ARGUMENTS_INVALID')
  const config = JSON.parse(await readFile(resolve(configFile), 'utf8'))
  if (!config.binding || !['test', 'dev'].includes(config.binding.environment)) throw Error('TEST_ONLY')
  const connection = config.connection ?? {}
  const db = await mysql.createConnection({ host: connection.host, port: connection.port, socketPath: connection.socketPath, user: connection.user, password: connection.password, database: connection.database, multipleStatements: true })
  try {
    const plan = await planGatewayMigration(db, target, config.binding, config.expectedSchemaHashes)
    const result = mode === '--apply'
      ? await applyGatewayMigration(db, target, config.binding, config.expectedSchemaHashes, reviewHash, config.backupDirectory)
      : mode === '--verify' ? await verifyGatewayMigration(db, target, config.expectedSchemaHashes) : plan
    console.log(JSON.stringify(result, null, 2))
  } finally { await db.end() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`GATEWAY_MIGRATION_FAILED (${(/^[A-Z_]+$/.test(error.message) ? error.message : error.code) || 'DETAILS_SUPPRESSED'})`)
    process.exitCode = 1
  })
}
