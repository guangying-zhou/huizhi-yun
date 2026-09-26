import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const table = 'assets_service_command_receipt'
const migrationPath = new URL('../../assets/docs/migrations/20260917_assets_owned_ip_asset_product_link_receipts.sql', import.meta.url)
const operations = [
  'assets.products.create.v1', 'assets.products.edit.v1',
  'assets.products.link-base.v1', 'assets.products.link-asset.v1', 'assets.products.link-document.v1',
  'assets.product-categories.save.v1',
  'assets.digital-assets.create.v1', 'assets.digital-assets.edit.v1',
  'assets.ip-assets.create.v1', 'assets.ip-assets.edit.v1', 'assets.ip-assets.link-product.v1'
]
const existingOperations = operations.slice(0, 6)
const requiredCapabilities = [
  'assets:product:edit', 'assets:admin:admin',
  'assets:digital-asset:create', 'assets:digital-asset:edit',
  'assets:ip-asset:create', 'assets:ip-asset:edit', 'assets:ip-asset:link-product'
]
const requiredGuards = [
  'source_app', 'target_app', 'source_deployment_code', 'deployment_code',
  'original_actor_uid', 'command_schema_version', 'assets-owned-command.v1'
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function sha(value) {
  return createHash('sha256').update(value).digest('hex')
}
function digest(value) {
  return sha(JSON.stringify(value))
}
function operationMarkers(clause) {
  return [...new Set(clause.match(/assets\.[a-z-]+(?:\.[a-z-]+)*\.v1/g) || [])].sort()
}
function constraintName(value) {
  assert(/^assets_chk_scr_cross_app_[a-f0-9]{8}$/.test(value), 'unexpected Assets receipt constraint')
  return `\`${value}\``
}

export async function planEnterpriseAssetsReceipts(db) {
  const [[{ database, instance }]] = await db.query('SELECT DATABASE() AS `database`,@@server_uuid AS instance')
  assert(database && /^[a-z][a-z0-9_]{0,63}$/.test(database), 'explicit unified database required')
  const [tables] = await db.execute('SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, table])
  assert(tables.length === 1 && tables[0].TABLE_TYPE === 'BASE TABLE', 'Assets owning receipt table missing')
  const [allChecks] = await db.execute(`SELECT tc.CONSTRAINT_NAME AS name,tc.ENFORCED AS enforced,cc.CHECK_CLAUSE AS clause
    FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=? AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'`, [database, table])
  const checks = allChecks.filter(check => /^assets_chk_scr_cross_app_[a-f0-9]{8}$/.test(check.name))
  assert(checks.length === 1 && checks[0].enforced === 'YES', 'Assets receipt CHECK missing or not enforced')
  const check = checks[0]
  constraintName(check.name)
  const clause = String(check.clause || '')
  assert(requiredGuards.every(marker => clause.includes(marker)), 'Assets receipt identity guard incomplete')
  assert(requiredCapabilities.slice(0, 2).every(marker => clause.includes(marker)), 'product receipt capability guard incomplete')
  const presentOperations = operationMarkers(clause)
  assert(presentOperations.every(marker => operations.includes(marker)), 'unexpected Assets receipt operation')
  assert(existingOperations.every(marker => presentOperations.includes(marker)), 'product receipt migration required')
  const [rows] = await db.query(`SELECT * FROM \`${table}\` ORDER BY receipt_id`)
  const migration = await readFile(migrationPath, 'utf8')
  const state = {
    database, instance, table, constraint: check.name, enforced: check.enforced,
    clauseSha256: sha(clause), presentOperations, receiptCount: rows.length,
    receiptSha256: digest(rows), migrationSha256: sha(migration)
  }
  return {
    ...state,
    ready: operations.every(marker => presentOperations.includes(marker))
      && requiredCapabilities.every(marker => clause.includes(marker)),
    schemaHash: digest(state)
  }
}

function migrationSql(migration, name) {
  const sql = migration.slice(migration.indexOf('ALTER TABLE service_command_receipt'))
  assert(sql.startsWith('ALTER TABLE service_command_receipt') && sql.trimEnd().endsWith(';'), 'unexpected Assets migration source')
  return sql.replace('ALTER TABLE service_command_receipt', `ALTER TABLE \`${table}\``)
    .replaceAll('chk_scr_cross_app', constraintName(name))
}

export async function applyEnterpriseAssetsReceipts(db, approvedSchemaHash) {
  assert(/^[a-f0-9]{64}$/.test(approvedSchemaHash || ''), 'review hash required')
  const [[{ locked }]] = await db.query("SELECT GET_LOCK(CONCAT('hzy-assets-receipts:',LEFT(SHA2(DATABASE(),256),40)),30) AS locked")
  assert(locked === 1, 'Assets receipt migration lock unavailable')
  try {
    const before = await planEnterpriseAssetsReceipts(db)
    assert(before.schemaHash === approvedSchemaHash, 'Assets receipt migration plan changed')
    if (!before.ready) {
      const migration = await readFile(migrationPath, 'utf8')
      await db.query(migrationSql(migration, before.constraint))
    }
    const after = await planEnterpriseAssetsReceipts(db)
    assert(after.ready && after.receiptCount === before.receiptCount && after.receiptSha256 === before.receiptSha256,
      'Assets receipt migration verification failed')
    assert(after.constraint === before.constraint && after.enforced === 'YES', 'Assets receipt constraint changed unexpectedly')
    return after
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT('hzy-assets-receipts:',LEFT(SHA2(DATABASE(),256),40)))")
  }
}

async function main() {
  const args = process.argv.slice(2)
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const configPath = option('--config'), tenant = option('--tenant'), database = option('--database')
  assert(configPath && tenant && database, '--config, --tenant, and --database required')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  assert(config.tenant === tenant && config.enterprise?.db?.database === database, 'tenant/database binding mismatch')
  const identity = {
    tenant, deployment: config.deployment, environment: config.enterprise.environment,
    generation: config.enterprise.generation, database
  }
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
    const planned = await planEnterpriseAssetsReceipts(db)
    assert(planned.instance.toLowerCase() === config.enterprise.instanceId.toLowerCase(), 'connected database/instance mismatch')
    const reviewHash = digest({ identity, schemaHash: planned.schemaHash })
    if (applying) assert(option('--review-hash') === reviewHash, 'tenant-bound review hash changed')
    const result = applying ? await applyEnterpriseAssetsReceipts(db, planned.schemaHash) : planned
    const { instance, receiptSha256, schemaHash, ...safe } = result
    console.log(JSON.stringify({ ...identity, ...safe, reviewHash, mode: applying ? 'applied' : 'plan' }, null, 2))
  } finally {
    await db.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Assets receipt migration stopped: ${error.code ?? error.message}`); process.exitCode = 1 })
}
