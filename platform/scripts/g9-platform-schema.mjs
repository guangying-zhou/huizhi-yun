#!/usr/bin/env node
// G-9: clone an already approved, local, read-only dump into an empty target.
// No connection to the source database is made by this tool.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const G9_MIGRATIONS = [
  'platform/docs/sql/HZY-Platform-SQL-Migration-v2.16-tenant-reserved-subdomains.sql',
  'platform/docs/sql/HZY-Platform-SQL-Migration-v2.22-tenant-role-catalog-metadata.sql',
  'platform/docs/sql/migrations/20260913-enterprise-entitlements.sql',
  'platform/docs/sql/migrations/20260913-enterprise-entitlement-state.sql',
  'platform/docs/sql/migrations/20260913-enterprise-order-fulfillments.sql',
  'platform/docs/sql/migrations/20260913-enterprise-order-approvals.sql',
  'platform/docs/sql/migrations/20260913-enterprise-external-drain-approval.sql',
  'platform/docs/sql/migrations/20260913-enterprise-recovery-route.sql',
  'platform/docs/sql/migrations/20260913-tenant-scheduler-ownership.sql',
  'platform/docs/sql/migrations/20260914-enterprise-drain-activity-approval.sql',
  'platform/docs/sql/migrations/20260923-console-service-keys.sql',
  'platform/docs/sql/migrations/20260926-gateway-service-keys.sql',
  'platform/docs/sql/migrations/20260929-enterprise-external-drain-generation.sql'
]

const sha = value => createHash('sha256').update(value).digest('hex')
const migrationSql = path => readFileSync(resolve(root, path), 'utf8')
export function migrationTables(sql) {
  return [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?\s*\(/gi)].map(match => match[1])
}
function createdTableShapes(sql) {
  return [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?\s*\(([\s\S]*?)\)\s*ENGINE\s*=/gi)].map(([, table, body]) => {
    const lines = body.split('\n').map(line => line.trim())
    const columns = lines.flatMap(line => {
      const match = /^`?([a-z][a-z0-9_]*)`?\s+(?:BIGINT|INT|TINYINT|SMALLINT|VARCHAR|CHAR|TEXT|LONGTEXT|JSON|DATETIME|TIMESTAMP|DECIMAL|BOOLEAN|BLOB|VARBINARY|ENUM)\b/i.exec(line)
      return match ? [match[1]] : []
    })
    const indexes = lines.flatMap(line => {
      if (/^PRIMARY\s+KEY\s*\(/i.test(line)) return ['PRIMARY']
      const match = /^(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([a-z][a-z0-9_]*)`?\s*\(/i.exec(line)
      return match ? [match[1]] : []
    })
    assert.ok(columns.length > 0, `G9_CREATE_SHAPE_UNKNOWN:${table}`)
    return { table, columns, indexes }
  })
}
function assertCreatedTablesComplete(inventory, shapes, path) {
  for (const shape of shapes) {
    const columns = new Set(inventory.columns.filter(row => row.tableName === shape.table).map(row => row.name))
    const indexes = new Set(inventory.indexes.filter(row => row.tableName === shape.table).map(row => row.name))
    assert.ok(shape.columns.every(name => columns.has(name)) && shape.indexes.every(name => indexes.has(name)), `G9_PARTIAL_MIGRATION:${path}:${shape.table}`)
  }
}
export function expectedG9Tables() {
  return [...new Set(G9_MIGRATIONS.flatMap(path => migrationTables(migrationSql(path))))].sort()
}

// This ALTER has three nontransactional steps. A table alone is not evidence
// that the generation fence was installed; a partial attempt needs restore.
const drainGeneration = {
  table: 'enterprise_external_drain_approvals',
  columns: ['target_generation', 'artifact_json'],
  index: 'uk_external_drain_generation',
  indexColumns: ['tenant_code', 'environment', 'cutover_key', 'target_generation']
}
function drainGenerationState(inventory) {
  const columns = new Set(inventory.columns.filter(row => row.tableName === drainGeneration.table).map(row => row.name))
  const index = inventory.indexes.filter(row => row.tableName === drainGeneration.table && row.name === drainGeneration.index)
  const present = drainGeneration.columns.filter(name => columns.has(name)).length + Number(index.length > 0)
  if (present === 0) return 'absent'
  assert.equal(present, 3, 'G9_PARTIAL_MIGRATION:external-drain-generation')
  const target = inventory.columns.find(row => row.tableName === drainGeneration.table && row.name === 'target_generation')
  const artifact = inventory.columns.find(row => row.tableName === drainGeneration.table && row.name === 'artifact_json')
  assert.equal(target.type.toLowerCase(), 'varchar(20)', 'G9_GENERATION_COLUMN_DRIFT')
  assert.equal(target.nullable, 'NO', 'G9_GENERATION_COLUMN_DRIFT')
  assert.equal(artifact.type.toLowerCase(), 'json', 'G9_ARTIFACT_COLUMN_DRIFT')
  assert.deepEqual(index.map(row => row.columnName), drainGeneration.indexColumns, 'G9_GENERATION_INDEX_DRIFT')
  assert.ok(index.every(row => Number(row.nonUnique) === 0), 'G9_GENERATION_INDEX_DRIFT')
  return 'complete'
}

export async function schemaInventory(db) {
  const [tables] = await db.query(`SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation
    FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`)
  const [columns] = await db.query(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal,
    COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`)
  const [indexes] = await db.query(`SELECT TABLE_NAME AS tableName,INDEX_NAME AS name,SEQ_IN_INDEX AS ordinal,
    COLUMN_NAME AS columnName,NON_UNIQUE AS nonUnique FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`)
  return { tables, columns, indexes }
}
export function inventoryDigest(inventory, excluded = []) {
  const omit = new Set(excluded)
  return sha(JSON.stringify(Object.fromEntries(Object.entries(inventory).map(([key, rows]) =>
    [key, rows.filter(row => !omit.has(row.name) && !omit.has(row.tableName))]))))
}

export async function migrateG9Schema(db) {
  const expected = expectedG9Tables()
  const before = await schemaInventory(db)
  const existing = new Set(before.tables.map(row => row.name))
  const applied = []
  for (const path of G9_MIGRATIONS) {
    const sql = migrationSql(path)
    const tables = migrationTables(sql)
    const isGenerationAlter = path.endsWith('/20260929-enterprise-external-drain-generation.sql')
    assert.ok(tables.length > 0 || isGenerationAlter, `G9_MIGRATION_NO_TABLE:${path}`)
    if (isGenerationAlter) {
      assert.ok(existing.has(drainGeneration.table), 'G9_GENERATION_TABLE_MISSING')
      const state = drainGenerationState(await schemaInventory(db))
      if (state === 'complete') continue
      await db.query(sql)
      assert.equal(drainGenerationState(await schemaInventory(db)), 'complete')
      applied.push({ path, tables: [], columns: drainGeneration.columns, indexes: [drainGeneration.index], sqlSha256: sha(sql) })
      continue
    }
    const present = tables.filter(name => existing.has(name))
    assert.ok(present.length === 0 || present.length === tables.length, `G9_PARTIAL_MIGRATION:${path}`)
    const shapes = createdTableShapes(sql)
    assert.equal(shapes.length, tables.length, `G9_CREATE_SHAPE_UNKNOWN:${path}`)
    if (present.length === tables.length) {
      assertCreatedTablesComplete(await schemaInventory(db), shapes, path)
      continue
    }
    // DDL is nontransactional. The operator restores the encrypted clone on failure.
    await db.query(sql)
    assertCreatedTablesComplete(await schemaInventory(db), shapes, path)
    tables.forEach(name => existing.add(name))
    applied.push({ path, tables, sqlSha256: sha(sql) })
  }
  const after = await schemaInventory(db)
  assert.deepEqual(expected.filter(name => !after.tables.some(row => row.name === name)), [], 'G9_SCHEMA_MISSING')
  assert.equal(drainGenerationState(after), 'complete')
  assert.equal(inventoryDigest(before, expected), inventoryDigest(after, expected), 'G9_EXISTING_SCHEMA_DRIFT')
  return { applied, expectedTables: expected.length, existingSchemaSha256: inventoryDigest(after, expected) }
}

export async function restoreG9Dump({ db, dumpPath, mysqlBinary = 'mysql' }) {
  assert.match(db.database, /^[A-Za-z][A-Za-z0-9_]*$/, 'G9_TARGET_DB_NAME')
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(db.host), 'G9_RESTORE_LOCAL_ONLY')
  const stat = statSync(dumpPath)
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, 'G9_DUMP_MUST_BE_0600')
  for await (const line of createInterface({ input: createReadStream(dumpPath), crlfDelay: Infinity })) {
    assert.doesNotMatch(line, /^\s*(?:CREATE|DROP|ALTER)\s+DATABASE\b|^\s*USE\s+[`'"a-z]/i, 'G9_DUMP_MUST_NOT_SELECT_DATABASE')
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(dumpPath)) digest.update(chunk)
  const connection = await mysql.createConnection({ ...db, multipleStatements: true })
  try {
    assert.equal((await schemaInventory(connection)).tables.length, 0, 'G9_TARGET_NOT_EMPTY')
  } finally { await connection.end() }
  await new Promise((done, fail) => {
    const child = spawn(mysqlBinary, ['--no-defaults', '--protocol=TCP', '--host', db.host, '--port', String(db.port || 3306), '--user', db.user,
      '--default-character-set=utf8mb4', db.database], {
      env: { ...process.env, MYSQL_PWD: db.password }, stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-1000)
    })
    createReadStream(dumpPath).pipe(child.stdin)
    child.on('error', fail)
    child.on('close', code => code === 0 ? done() : fail(new Error(`G9_IMPORT_EXIT_${code}:${stderr.replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')}`)))
  })
  return { restored: true, dumpSha256: digest.digest('hex'), target: db.database }
}

function protectedConfig(path) {
  const stat = statSync(path)
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, 'G9_CONFIG_MUST_BE_0600')
  return JSON.parse(readFileSync(path, 'utf8'))
}
async function main() {
  const [mode, configPath, dumpPath] = process.argv.slice(2)
  assert.ok(['--restore', '--migrate', '--inventory'].includes(mode), 'G9_MODE')
  const { db } = protectedConfig(resolve(configPath))
  if (mode === '--restore') return console.log(JSON.stringify(await restoreG9Dump({ db, dumpPath })))
  const connection = await mysql.createConnection({ ...db, multipleStatements: true, dateStrings: true })
  try {
    const result = mode === '--migrate' ? await migrateG9Schema(connection) : await schemaInventory(connection)
    console.log(JSON.stringify(result))
  } finally { await connection.end() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`G9_STOPPED:${String(error.message).slice(0, 200)}`)
  process.exitCode = 1
})
