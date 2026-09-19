#!/usr/bin/env node
// Exact local test migration. Default is read-only; no credentials in output.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import mysql from '../../platform/node_modules/mysql2/promise.js'
const root = resolve(import.meta.dirname, '../..')
const runtimeRoot = resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime')
import { parseAssetsReceiptMigrationArgs, assertAssetsReceiptMigrationSource, observeAssetsReceiptConstraints, linkReceiptMigration } from './enterprise-assets-receipt-contract.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
let db, locked = false
try {
 const { mode, reviewHash: approvedHash, migrationPath } = parseAssetsReceiptMigrationArgs(process.argv.slice(2))
 const config = JSON.parse(await readFile(resolve(runtimeRoot, 'config.json'), 'utf8'))
 const source = config.apps?.assets?.db
 if (config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime' || config.deploymentBindings?.assets !== 'C000001-test-assets' || config.enterprise?.enabled === true || source?.host !== '127.0.0.1' || Number(source.port) !== 3306 || source.database !== 'hzy_assets_test_local_20260910') throw Error('TARGET_MISMATCH')
 db = await mysql.createConnection({ host: source.host, port: source.port, user: source.user, password: source.password, database: source.database })
 const [[identity]] = await db.query('SELECT DATABASE() name,@@server_uuid instanceId')
 if (identity.instanceId !== '37d8994e-4c12-11ee-afad-8cb2da2e572b' || identity.name !== source.database) throw Error('INSTANCE_MISMATCH')
 if (mode === '--apply') {
  const [[result]] = await db.query("SELECT GET_LOCK('hzy:C000001:assets-owned-receipt',0) acquired")
  if (result.acquired !== 1) throw Error('MIGRATION_LOCK_BUSY')
  locked = true
  await db.query('SET SESSION lock_wait_timeout=5')
 }
 const [[ddl]] = await db.query('SHOW CREATE TABLE service_command_receipt')
 const before = ddl['Create Table']
 const [constraints] = await db.query("SELECT tc.CONSTRAINT_NAME name,tc.ENFORCED enforced,cc.CHECK_CLAUSE clause FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='service_command_receipt' AND tc.CONSTRAINT_NAME='chk_scr_cross_app'")
 const observed = assertAssetsReceiptMigrationSource(constraints, migrationPath)
 const sql = await readFile(resolve(root, migrationPath), 'utf8')
 const plan = { tenant: config.tenant, database: source.database, instanceId: identity.instanceId, migrationPath, migrationSha256: hash(sql), beforeDdlSha256: hash(before) }
 const reviewHash = hash(JSON.stringify(plan))
 if (mode === '--apply') {
  if (reviewHash !== approvedHash) throw Error('REVIEW_HASH_MISMATCH')
  const backupDir = resolve(runtimeRoot, 'schema-backups', `assets-owned-receipt-${reviewHash}`)
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  // Exclusive backup creation prevents a retry from replacing the original DDL.
  try { await writeFile(resolve(backupDir, 'before.sql'), `${before};\n`, { mode: 0o600, flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST' || await readFile(resolve(backupDir, 'before.sql'), 'utf8') !== `${before};\n`) throw Error('BACKUP_CONFLICT') }
  await db.query(sql)
  const [[after]] = await db.query('SHOW CREATE TABLE service_command_receipt')
  const [verified] = await db.query("SELECT tc.CONSTRAINT_NAME name,tc.ENFORCED enforced,cc.CHECK_CLAUSE clause FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='service_command_receipt' AND tc.CONSTRAINT_NAME='chk_scr_cross_app'")
  const ready = observeAssetsReceiptConstraints(verified)
  if (!(migrationPath === linkReceiptMigration ? ready.linksReady : ready.masterReady)) throw Error('POST_MIGRATION_VERIFICATION_FAILED')
  const receipt = { ...plan, reviewHash, appliedAt: new Date().toISOString(), afterDdlSha256: hash(after['Create Table']), enforced: true, businessRowsMutated: false, sourcePlanRegenerationRequired: true }
  await writeFile(resolve(backupDir, 'receipt.json'), `${JSON.stringify(receipt,null,2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify(receipt,null,2))
 } else console.log(JSON.stringify({ mode, ...plan, reviewHash, alreadyHasOwnedMarker: observed.masterReady, alreadyHasLinkCommands: observed.linksReady, mutationsPerformed: false },null,2))
} catch (error) {
 console.error(`ASSETS_RECEIPT_MIGRATION_FAILED (${error?.code || (/^[A-Z_]+$/.test(error?.message || '') ? error.message : 'details suppressed')})`)
 process.exitCode = 1
} finally {
 if (locked) { try { await db.query("SELECT RELEASE_LOCK('hzy:C000001:assets-owned-receipt')") } catch {} }
 await db?.end()
}
