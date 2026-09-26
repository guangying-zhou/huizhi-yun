import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { collectProviderReceipts, probeColumns } from '../server/utils/enterpriseProviderReceipts.mjs'
import { generateKeyPairSync, createHash, createHmac, verify } from 'node:crypto'
import { resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { statSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { registerEnterpriseNuxtTestHost } from './support/enterprise-nuxt-test-host.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const pool = mysql.createPool({ ...context.connection('console'), multipleStatements: true })
  const hooks = registerEnterpriseNuxtTestHost(rootDir)
  const directoryHook = registerHooks({ resolve(specifier, context, nextResolve) { const result = nextResolve(specifier, context); if (result.url.startsWith('file:')) { const path = fileURLToPath(result.url); if (statSync(path).isDirectory()) { const entry = ['index.ts', 'index.js'].map(name => resolve(path, name)).find(existsSync); if (entry) return { ...result, url: pathToFileURL(entry).href } } } return result } })
  const original = { config: globalThis.useRuntimeConfig, fetch: globalThis.fetch, key: process.env.CUTOVER_TEST_KEY, drain: process.env.HZY_DRAIN_CONTROL_TOKEN }
  const key = generateKeyPairSync('ed25519')
  process.env.CUTOVER_TEST_KEY = key.privateKey.export({ type: 'pkcs8', format: 'pem' })
  process.env.HZY_DRAIN_CONTROL_TOKEN = 'isolated-drain-token'
  globalThis.useRuntimeConfig = () => ({ db: { ...context.connection('console'), name: context.connection('console').database } })
  let appPool
  try {
    await pool.query("CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY);INSERT INTO tenants VALUES('C000001');CREATE TABLE platform_signing_keys(id BIGINT PRIMARY KEY,kid VARCHAR(128),alg VARCHAR(32),public_key TEXT,private_key_ref VARCHAR(255),status VARCHAR(32),activated_at DATETIME,rotated_at DATETIME NULL,revoked_at DATETIME NULL)")
    await pool.query(await readFile(resolve(rootDir,'platform/docs/sql/migrations/20260913-enterprise-external-drain-approval.sql'),'utf8'))
    for(const [schema,kind,table] of [['hzy_aims','source','integration_operation'],['hzy_altoc','source','integration_operation'],['hzy_people','receipt','service_command_receipt'],['hzy_console','notification','portal_notification_deliveries']]) await pool.query(`CREATE TABLE ${schema}.${table}(${probeColumns[kind].map(name=>`\`${name}\` VARCHAR(191) NULL`).join(',')})`)
    await pool.query('CREATE TABLE portal_notifications(notification_id VARCHAR(64),source_app_code VARCHAR(64))')
    const operation = {operation_id:'operation-1',operation_key:'key-1',tenant_code:'C000001',deployment_code:'C000001-test-aims',source_app:'aims',target_app:'finance',operation_code:'aims.finance.example.v1',required_capability:'finance:example',idempotency_key:'key-1',command_schema_version:'v1',command_sha256:'a'.repeat(64),status:'succeeded',attempt_count:'1',locked_by:null,locked_until:null,target_receipt_id:'receipt-1',target_biz_type:'example',target_biz_code:'B1',response_summary_sha256:'b'.repeat(64)}
    const receipt = {...operation,receipt_id:'receipt-1',source_deployment_code:operation.deployment_code,deployment_code:'C000001-test-finance'}
    for(const [table,kind,row] of [['hzy_aims.integration_operation','source',operation],['hzy_people.service_command_receipt','receipt',receipt]]) await pool.execute(`INSERT INTO ${table} VALUES(${probeColumns[kind].map(()=>'?').join(',')})`,probeColumns[kind].map(column=>row[column]??null))
    await pool.execute("INSERT INTO platform_signing_keys VALUES(1,'cutover-fixture','Ed25519',?,'env:CUTOVER_TEST_KEY','active',UTC_TIMESTAMP(),NULL,NULL)", [key.publicKey.export({ type: 'spki', format: 'pem' })])
    const actors = ['aims', 'assets'].map(app => ({ app, deployment: `C000001-test-${app}`, artifactSha256: 'a'.repeat(64) }))
    const [[instance]]=await pool.query('SELECT @@server_uuid instanceId')
    const binding={tenant:'C000001',environment:'test',runtimeDeployment:'fixture-runtime',instanceId:instance.instanceId,sources:[{app:'aims',schema:'hzy_aims',deployment:'C000001-test-aims'},{app:'assets',schema:'hzy_altoc',deployment:'C000001-test-assets'}],unconfiguredProviders:['altoc','codocs','people'],providers:[{app:'aims',schema:'hzy_aims',deployment:'C000001-test-aims'},{app:'assets',schema:'hzy_altoc',deployment:'C000001-test-assets'},{app:'finance',schema:'hzy_people',deployment:'C000001-test-finance'},{app:'console',schema:'hzy_console',deployment:'wiztek-test-console'}]}
    const report=await collectProviderReceipts(pool,binding)
    assert.equal(report.automaticCount,1);assert.equal(report.manualCount,10);assert.equal(report.ready,false)
    const payload = JSON.stringify({ schemaVersion:'enterprise-external-drain.v1',tenant:'C000001',environment:'test',revision:4,mode:'sealed',ingressDrained:true,seal:{cutoverKey:'cutover-1',targetGeneration:'7'},contract:{actors} })
    const seal = { payload, signature:createHmac('sha256',process.env.HZY_DRAIN_CONTROL_TOKEN).update(payload).digest('hex'),alg:'HS256' }
    const decisions=report.entries.filter(entry=>entry.classification==='manual-required').map(entry=>({entryId:entry.id,entrySha256:createHash('sha256').update(JSON.stringify(entry)).digest('hex'),outcome:['coverage:pre-wrapper-inflight-history','coverage:external-notification-providers'].includes(entry.id)?'verified-terminal':'verified-consumer-coverage',evidenceKind:'activity-ledger',reference:'fixture-ledger://isolated/observed-consumer-completion',evidenceSha256:'c'.repeat(64),explanation:'Isolated fixture contains an explicit inspected consumer ledger; no elapsed-time assumption.'}))
    const input={report,seal,decisions,requestId:'review-1',approvalReference:'fixture-reviewed-provider-ledger'}
    const { useDbPool } = await import('../server/utils/db.ts'); appPool = useDbPool()
    const { approveExternalDrain } = await import('../server/utils/enterpriseExternalDrainApproval.ts')
    await assert.rejects(()=>approveExternalDrain({...input,decisions:[]},'operator',true),/manual_evidence_incomplete/)
    await assert.rejects(()=>approveExternalDrain(input,'',true),/approval_audit_required/)
    const dry=await approveExternalDrain(input,'operator',false);assert.equal(dry.applied,false)
    assert.equal((await pool.query('SELECT COUNT(*) count FROM enterprise_external_drain_approvals'))[0][0].count,0)
    const signed=await approveExternalDrain(input,'operator',true)
    assert.equal(verify(null,Buffer.from(signed.payload),key.publicKey,Buffer.from(signed.signature,'base64url')),true)
    assert.equal((await approveExternalDrain(input,'operator',true)).replayed,true)
    await assert.rejects(()=>approveExternalDrain({...input,approvalReference:'changed reference'},'operator',true),/immutable_approval_conflict/)
    const dir=await mkdtemp('/tmp/hzy-external-report-')
    try {
      const file=resolve(dir,'approval.json')
      await writeFile(file,JSON.stringify({payload:signed.payload,signature:signed.signature,publicKey:key.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url')}),{mode:0o600})
      await new Promise((done,reject)=>{const child=spawn('go',['test','./internal/migrations/unified','-run','^TestApprovedExternalEvidenceMySQL$','-count=1','-v'],{cwd:resolve(rootDir,'data-runtime'),stdio:'inherit',env:{...process.env,HZY_EXTERNAL_EVIDENCE_SOCKET:context.socketPath,HZY_EXTERNAL_EVIDENCE_FILE:file}});child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error('Go evidence verification failed')))})
    } finally {await rm(dir,{recursive:true,force:true})}
    console.log('Actual source/provider collection → Platform immutable manual approval/signature → Go transaction recheck passed')
  } finally {
    if (appPool) await appPool.end()
    await pool.end(); directoryHook.deregister(); hooks.deregister()
    globalThis.useRuntimeConfig = original.config; globalThis.fetch = original.fetch
    for (const [name, value] of [['CUTOVER_TEST_KEY', original.key], ['HZY_DRAIN_CONTROL_TOKEN', original.drain]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent:'/tmp' })
