#!/usr/bin/env node
// Read-only C000001 inventory. Credentials stay in memory; no SQL/DSN diagnostics.
import { readFile, writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import mysql from '../../platform/node_modules/mysql2/promise.js'
import { observeAssetsReceiptConstraints, assetsReceiptMigrations } from './enterprise-assets-receipt-contract.mjs'
const root = resolve(import.meta.dirname, '../..')
const planPath = process.argv[2]
const outputPath = process.argv[3]
if (!planPath || !outputPath) throw Error('Reviewed read-only plan input and report output paths required')
let db
let adminDb
try {
 const config = JSON.parse(await readFile(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json'), 'utf8'))
 const adminConfig = JSON.parse(await readFile(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/enterprise-migration-admin.json'), 'utf8'))
 const plan = JSON.parse(await readFile(planPath, 'utf8'))
 const source = config.apps.aims.db
 if (config.tenant !== 'C000001' || !['127.0.0.1', 'localhost'].includes(source.host) || !['127.0.0.1', 'localhost'].includes(adminConfig.host) || plan.Config.Tenant !== config.tenant || plan.Config.SourceAims !== source.database || plan.Config.SourceAssets !== config.apps.assets.db.database || config.apps.assets.db.host !== source.host) throw Error('Local source identity mismatch')
 db = await mysql.createConnection({ host: source.host, port: source.port, user: source.user, password: source.password, timezone: 'Z' })
 adminDb = await mysql.createConnection({ host: adminConfig.host, port: adminConfig.port, user: adminConfig.user, password: adminConfig.password, timezone: 'Z' })
 await db.query('SET TRANSACTION READ ONLY')
 await db.beginTransaction()
 const [[identity]] = await db.query('SELECT @@server_uuid instanceId,@@version version')
 if (identity.instanceId !== plan.Config.InstanceID) throw Error('Source instance mismatch')
 const [schemas] = await db.query('SELECT SCHEMA_NAME name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?,?)', [plan.Config.SourceAims, plan.Config.SourceAssets, plan.Config.Target])
 const operations = []
 for (const table of plan.Tables.filter(row => row.Name === 'integration_operation')) {
  const qualified = `\`${table.Source}\`.\`${table.Name}\``
  const [statuses] = await db.query(`SELECT status,COUNT(*) count FROM ${qualified} GROUP BY status ORDER BY status`)
  operations.push({ domain: table.Domain, table: table.Name, statuses, undrained: statuses.filter(row => !['succeeded', 'cancelled'].includes(row.status)).reduce((count, row) => count + Number(row.count), 0) })
 }
 const [sourceFences] = await db.query("SELECT TABLE_SCHEMA source,TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (?,?) AND TABLE_NAME='enterprise_source_fence'", [plan.Config.SourceAims, plan.Config.SourceAssets])
 const targetExists = schemas.some(row => row.name === plan.Config.Target)
 const [privileges] = await db.query('SELECT GRANTEE principal,PRIVILEGE_TYPE privilege,IS_GRANTABLE grantable FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA=? ORDER BY GRANTEE,PRIVILEGE_TYPE', [plan.Config.Target])
 const proposedUser = 'hzy_enterprise_test_runtime'
 const proposedHost = 'localhost'
 const proposedGrantee = `'${proposedUser}'@'${proposedHost}'`
 await adminDb.query('SET TRANSACTION READ ONLY')
 await adminDb.beginTransaction()
 const [[principal]] = await adminDb.query("SELECT COUNT(*) accountCount FROM mysql.user WHERE User=? AND Host=?", [proposedUser, proposedHost])
 const [principalGlobalPrivileges] = await adminDb.query('SELECT PRIVILEGE_TYPE privilege,IS_GRANTABLE grantable FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=? ORDER BY PRIVILEGE_TYPE', [proposedGrantee])
 const [principalSchemaPrivileges] = await adminDb.query('SELECT TABLE_SCHEMA schemaName,PRIVILEGE_TYPE privilege,IS_GRANTABLE grantable FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=? ORDER BY TABLE_SCHEMA,PRIVILEGE_TYPE', [proposedGrantee])
 const [principalTablePrivileges] = await adminDb.query('SELECT TABLE_SCHEMA schemaName,TABLE_NAME tableName,PRIVILEGE_TYPE privilege,IS_GRANTABLE grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=? ORDER BY TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE', [proposedGrantee])
 await adminDb.rollback()
 const expectedRuntimeSchemaPrivileges = ['DELETE', 'INSERT', 'SELECT', 'UPDATE']
 const compatibilitySql = await readFile(resolve(root, 'deploy/test-env/artifacts/C000001.enterprise-compatibility-views.candidate.sql'), 'utf8')
 const expectedCompatibilityViews = [...compatibilitySql.matchAll(/CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `[^`]+`.`([^`]+)`/g)].map(match => match[1]).sort()
 if (expectedCompatibilityViews.length !== 55 || new Set(expectedCompatibilityViews).size !== 55) throw Error('compatibility view inventory mismatch')
 const actualTargetPrivileges = targetExists ? principalSchemaPrivileges.filter(row => row.schemaName === plan.Config.Target).map(row => row.privilege).sort() : []
 const unexpectedSchemaPrivileges = principalSchemaPrivileges.filter(row => row.schemaName !== plan.Config.Target || !expectedRuntimeSchemaPrivileges.includes(row.privilege) || row.grantable !== 'NO').map(row => `${row.schemaName}:${row.privilege}:${row.grantable}`).sort()
 const targetTablePrivileges = targetExists ? principalTablePrivileges.filter(row => row.schemaName === plan.Config.Target) : []
 const showViewNames = targetTablePrivileges.filter(row => row.privilege === 'SHOW VIEW').map(row => row.tableName).sort()
 const missingCompatibilityViews = expectedCompatibilityViews.filter(name => !showViewNames.includes(name))
 const unexpectedTablePrivileges = principalTablePrivileges.filter(row => row.schemaName !== plan.Config.Target || row.privilege !== 'SHOW VIEW' || !expectedCompatibilityViews.includes(row.tableName) || row.grantable !== 'NO').map(row => `${row.schemaName}:${row.tableName}:${row.privilege}:${row.grantable}`).sort()
 const compatibilityViewsVerified = targetExists && missingCompatibilityViews.length === 0 && new Set(showViewNames).size === expectedCompatibilityViews.length && showViewNames.length === expectedCompatibilityViews.length && unexpectedTablePrivileges.length === 0
 const targetDmlVerified = targetExists && Number(principal.accountCount) > 0 && JSON.stringify(actualTargetPrivileges) === JSON.stringify(expectedRuntimeSchemaPrivileges) && unexpectedSchemaPrivileges.length === 0 && compatibilityViewsVerified
 const principalInventory = {
  user: proposedUser, host: proposedHost, exists: Number(principal.accountCount) > 0,
  globalPrivileges: principalGlobalPrivileges, schemaPrivileges: principalSchemaPrivileges,
  targetSchemaPrivileges: targetExists ? actualTargetPrivileges : [], unexpectedSchemaPrivileges,
  tablePrivileges: principalTablePrivileges, targetCompatibilityViewPrivileges: targetTablePrivileges,
  requiredSchemaPrivileges: expectedRuntimeSchemaPrivileges, requiredCompatibilityViews: expectedCompatibilityViews,
  missingCompatibilityViews, unexpectedTablePrivileges, compatibilityViewsVerified, targetDmlVerified,
  verificationScope: targetExists ? 'administrator metadata read; target schema and exact compatibility view grants checked' : 'account/grant metadata read; target schema does not exist',
  verificationLimit: targetExists ? null : 'target schema does not exist; configured grants are not counted as effective target DML'
 }
 const [[currentRights]] = await db.query("SELECT COUNT(*) globalDmlPrivileges FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=CONCAT(CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),'@',CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39)) AND PRIVILEGE_TYPE IN ('SELECT','INSERT','UPDATE','DELETE')")
 const asynchronousTableCounts = plan.Tables.filter(table => /integration_operation|service_command_receipt|product_document_creation_requests/.test(table.Name)).map(table => ({ domain: table.Domain, table: table.Name, rows: table.Count }))
 const [triggers] = await db.query('SELECT TRIGGER_SCHEMA source,EVENT_OBJECT_TABLE tableName,TRIGGER_NAME name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA IN (?,?) ORDER BY TRIGGER_SCHEMA,TRIGGER_NAME', [plan.Config.SourceAims, plan.Config.SourceAssets])
 const [assetReceiptConstraints] = await db.query("SELECT tc.CONSTRAINT_NAME name,tc.ENFORCED enforced,cc.CHECK_CLAUSE clause FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=? AND tc.TABLE_NAME='service_command_receipt' AND tc.CONSTRAINT_TYPE='CHECK' ORDER BY tc.CONSTRAINT_NAME", [plan.Config.SourceAssets])
 const receiptObserved = observeAssetsReceiptConstraints(assetReceiptConstraints)
 const ownedReceiptSchema = {
  observedConstraints: assetReceiptConstraints,
  migrationMarkerPresentAndEnforced: receiptObserved.masterReady,
  linkCommandsPresentAndEnforced: receiptObserved.linksReady,
  validationScope: 'metadata observation only; Runtime schema checks and command regression remain required',
  requiredMigration: assetsReceiptMigrations[0],
  requiredMigrations: assetsReceiptMigrations,
  pendingMigrations: assetsReceiptMigrations.filter((_, index) => !(index === 0 ? receiptObserved.masterReady : receiptObserved.linksReady))
 }
 await db.rollback()
 const report = {
  schemaVersion: 'enterprise-source-readiness.v1', observedAt: new Date().toISOString(), mode: 'read-only', tenantCode: config.tenant,
  runtimeDeployment: config.deployment, instanceId: identity.instanceId, mysqlVersion: identity.version,
  sourcePlan: { reviewHash: plan.ReviewHash, tables: plan.Tables.length, rows: plan.Tables.reduce((count, table) => count + table.Count, 0), ddlHash: createHash('sha256').update(JSON.stringify(plan.Tables.map(({ Domain, Name, DDL, Triggers }) => ({ Domain, Name, DDL, Triggers })))).digest('hex') },
  sources: { aims: source.database, assets: config.apps.assets.db.database },
  target: { proposedDatabase: plan.Config.Target, exists: targetExists, visibleDmlPrincipals: privileges, privilegeInventoryScope: 'source connection visibility', proposedPrincipal: principalInventory, sourceRuntimePrincipalHasGlobalDml: Number(currentRights.globalDmlPrivileges) > 0, status: targetDmlVerified ? 'principal-target-dml-verified' : 'principal-provisioned-target-unverified' },
  runtime: { enterpriseEnabled: config.enterprise?.enabled === true, localBindings: { aims: config.deploymentBindings.aims, assets: config.deploymentBindings.assets, enterprise: config.deploymentBindings.enterprise }, binaryAcceptanceRequired: true },
  sourceFences, triggers, operations, asynchronousTableCounts, ownedReceiptSchema,
  canActivate: false, noMutationsPerformed: true,
  requiredBeforeActivation: ['Assets master and product-link receipt source migrations and regenerated source plan', 'dedicated target schema and minimal principal provisioning', 'actual Runtime binary/config release acceptance', 'source guard installation and exact external drain evidence', 'fenced final-copy plan and reviewed activation receipt', 'controlled compatibility views and registry generation', 'scheduler ownership and Gateway route read-back']
 }
 const binaryObservation = { observedAt: new Date().toISOString(), available: false }
 try {
  const binaryPath = resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/hzy-data-runtime')
  const [binary, metadata] = await Promise.all([readFile(binaryPath), stat(binaryPath)])
  Object.assign(binaryObservation, { available: true, binarySha256: createHash('sha256').update(binary).digest('hex'), binaryBytes: binary.length, binaryModifiedAt: metadata.mtime.toISOString(), routeLiteralMarkers: Object.fromEntries(['/v1/enterprise/aims/integration-operations:claim', '/v1/enterprise/products', 'x-hzy-scheduler-generation'].map(marker => [marker, binary.includes(Buffer.from(marker))])) })
 } catch { binaryObservation.reason = 'actual binary unavailable' }
 if (['127.0.0.1', 'localhost'].includes(config.server?.host) && Number.isInteger(config.server?.port)) {
  try {
   const response = await fetch(`http://${config.server.host}:${config.server.port}/runtime/healthz`, { signal: AbortSignal.timeout(5000), redirect: 'error' })
   const body = await response.json()
   binaryObservation.health = { observedAt: new Date().toISOString(), httpStatus: response.status, fields: Object.fromEntries(Object.entries(body).filter(([key]) => ['status', 'version', 'deployment', 'tenant'].includes(key))) }
  } catch { binaryObservation.health = { observedAt: new Date().toISOString(), available: false } }
 }
 report.runtime.actualLocalBinary = binaryObservation

 await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
 console.log(JSON.stringify({ mode: report.mode, tables: report.sourcePlan.tables, rows: report.sourcePlan.rows, targetExists: report.target.exists, undrained: operations.reduce((count, row) => count + row.undrained, 0), sourceFenceCount: sourceFences.length, report: outputPath }))
} catch (error) {
 console.error(`Read-only enterprise source inventory failed (${error?.code || error?.name || 'unknown'}); credential-bearing diagnostics suppressed.`)
 process.exitCode = 1
} finally { if (adminDb) await adminDb.end(); if (db) await db.end() }
