import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { createApp, toNodeListener, defineEventHandler } from 'h3'
import { TestDrainCoordinator } from '../../deploy/test-env/drain/coordinator.mjs'
import { startCutoverGoHttpFixture } from './support/cutover-go-http-fixture.mjs'
import { generateKeyPairSync, createHash, createHmac, verify, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { statSync, existsSync, readFileSync } from 'node:fs'
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
  let appPool, go, httpServer, activityServer, sqlite
  try {
    await pool.query("CREATE TABLE tenant_runtime_instances(id INT,tenant_code VARCHAR(64),environment VARCHAR(32),runtime_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255),control_token_hash CHAR(64)); INSERT INTO tenant_runtime_instances VALUES(1,'C000001','test','runtime-1','ready','https://runtime.fixture.invalid',SHA2('isolated-control',256)); CREATE TABLE deployments(tenant_code VARCHAR(64),environment VARCHAR(32),app_code VARCHAR(32),deployment_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255)); INSERT INTO deployments VALUES('C000001','test','aims','C000001-test-aims','active','https://runtime.fixture.invalid'),('C000001','test','assets','C000001-test-assets','active','https://runtime.fixture.invalid'); CREATE TABLE tenant_scheduler_ownership(tenant_code VARCHAR(64),environment VARCHAR(32),source_app VARCHAR(32),storage_mode VARCHAR(32),runtime_code VARCHAR(128),worker_deployment VARCHAR(128),generation BIGINT); INSERT INTO tenant_scheduler_ownership VALUES('C000001','test','aims','unified','runtime-1','C000001-test-aims',7); CREATE TABLE platform_signing_keys(id BIGINT PRIMARY KEY,kid VARCHAR(128),alg VARCHAR(32),public_key TEXT,private_key_ref VARCHAR(255),status VARCHAR(32),activated_at DATETIME,rotated_at DATETIME NULL,revoked_at DATETIME NULL)")
    await pool.execute("INSERT INTO platform_signing_keys VALUES(1,'cutover-fixture','Ed25519',?,'env:CUTOVER_TEST_KEY','active',UTC_TIMESTAMP(),NULL,NULL)", [key.publicKey.export({ type: 'spki', format: 'pem' })])
    await pool.query("CREATE TABLE enterprise_external_drain_approvals(tenant_code VARCHAR(64),environment VARCHAR(32),cutover_key VARCHAR(191),seal_revision BIGINT,seal_payload_sha256 CHAR(64),payload_sha256 CHAR(64),actor_uid VARCHAR(128))")
    const actors = ['aims', 'assets'].map(app => ({ app, deployment: `C000001-test-${app}`, artifactSha256: 'a'.repeat(64) }))
    sqlite = new DatabaseSync(':memory:')
    const state = { storage: { sql: { exec(query, ...args) { const statement = sqlite.prepare(query); return statement.columns().length ? statement.all(...args) : (statement.run(...args), []) } }, transactionSync(fn) { sqlite.exec('BEGIN IMMEDIATE'); try { const result = fn(); sqlite.exec('COMMIT'); return result } catch (error) { sqlite.exec('ROLLBACK'); throw error } } } }
    const coordinator = new TestDrainCoordinator(state, { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-worker', HZY_DRAIN_CONTROL_TOKEN: process.env.HZY_DRAIN_CONTROL_TOKEN, HZY_PLATFORM_SIGNING_KID: 'cutover-fixture', HZY_PLATFORM_SIGNING_PUBLIC_KEY: key.publicKey.export({ type: 'spki', format: 'pem' }) })
    const control = (path, body = {}) => coordinator.fetch(new Request(`https://drain.fixture${path}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.HZY_DRAIN_CONTROL_TOKEN}` }, body: JSON.stringify({ tenant: 'C000001', environment: 'test', ...body }) }))
    assert.equal((await control('/register', { requestId: 'register', actors })).status, 200)
    assert.equal((await control('/open', { requestId: 'open', expectedRevision: 1 })).status, 200)
    await pool.query("CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY); INSERT INTO tenants VALUES('C000001')")
    await pool.query(readFileSync(resolve(rootDir,'platform/docs/sql/migrations/20260914-enterprise-drain-activity-approval.sql'),'utf8'))
    const ddl=readFileSync(resolve(rootDir,'platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql'),'utf8')
    for(const name of ['platform_accounts','platform_resources','platform_roles','platform_role_permissions','platform_account_roles']) {
      const table=ddl.match(new RegExp('CREATE TABLE IF NOT EXISTS `'+name+'`[\\s\\S]*?;'))?.[0]
      assert.ok(table,name); await pool.query(table)
    }
    const {useDbPool: activityPool}=await import('../server/utils/db.ts'); appPool=activityPool()
    const {ensureOpsRbacReady}=await import('../server/utils/platformOpsRbac.ts'); await ensureOpsRbacReady(['fixture-reviewer'])
    const activityHandler=(await import('../server/api/platform/ops/deployments/drain-activity/index.post.ts')).default
    activityServer=createServer(toNodeListener(createApp().use(defineEventHandler(event=>{
      event.context.platformUid=event.node.req.headers['x-fixture-actor']; event.context.platformAccessScope=event.node.req.headers['x-fixture-scope']
    })).use('/review',activityHandler)))
    await new Promise(resolve=>activityServer.listen(0,'127.0.0.1',resolve))
    const review=async body=>fetch(`http://127.0.0.1:${activityServer.address().port}/review`,{method:'POST',headers:{'content-type':'application/json','x-fixture-actor':'fixture-reviewer','x-fixture-scope':'ops'},body:JSON.stringify(body)})
    const workerControl=(path,body)=>coordinator.fetch(new Request(`https://drain.fixture${path}`,{method:'POST',headers:{authorization:'Bearer fixture-worker'},body:JSON.stringify({tenant:'C000001',environment:'test',...body})}))
    assert.equal((await workerControl('/begin',{...actors[0],id:'uncertain-response'})).status,200)
    assert.equal((await workerControl('/finish',{...actors[0],id:'uncertain-response',admissionRevision:2,outcome:'uncertain',reason:'provider-response-lost'})).status,200)
    assert.equal((await workerControl('/begin',{...actors[1],id:'lost-active'})).status,200)
    assert.equal((await control('/close', { requestId: 'close', expectedRevision: 2 })).status, 200)
    assert.equal((await control('/seal',{requestId:'premature',expectedRevision:3,cutoverKey:'cutover-1',targetGeneration:'7'})).status,409)
    const closed=await (await control('/snapshot')).json()
    const decision={outcome:'verified-terminal',evidenceKind:'provider-query',reference:'fixture-provider-receipt-1',evidenceSha256:createHash('sha256').update('actual fixture receipt').digest('hex'),explanation:'Fixture provider query confirms final result and execution ended.'}
    const request={snapshot:closed,activityId:'uncertain-response',requestId:'activity-review-1',decision}
    assert.equal((await review({...request,decision:{...decision,outcome:'timeout'}})).status,409)
    assert.equal((await review({...request,mode:'plan'})).status,200)
    assert.equal((await pool.query('SELECT COUNT(*) n FROM enterprise_drain_activity_approvals'))[0][0].n,0)
    const approvalResponse=await review({...request,mode:'approve'}); assert.equal(approvalResponse.status,200,await approvalResponse.clone().text())
    const approval=await approvalResponse.json()
    for(const mutate of [
      value=>{value.actor.deployment='wrong'},value=>{value.actor.artifactSha256='f'.repeat(64)},
      value=>{value.activity.admitted_revision=1},value=>{value.closedRevision=2},
      value=>{value.activitySha256='f'.repeat(64)},value=>{value.expiresAt=new Date(0).toISOString()},
      value=>{value.decision.outcome='timeout'},value=>{value.tenant='other'}
    ]) {
      const changed=JSON.parse(approval.payload); mutate(changed); const {approvalSha256:oldHash,expiresAt,...immutable}=changed; changed.approvalSha256=createHash('sha256').update(JSON.stringify(immutable)).digest('hex')
      const payload=JSON.stringify(changed), forged={...approval,payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64url')}
      assert.equal((await control('/reconcile',{requestId:request.requestId,expectedRevision:3,resolution:forged})).status,409)
      assert.equal(sqlite.prepare('SELECT status FROM activity').get().status,'uncertain')
    }
    const denied=await fetch(`http://127.0.0.1:${activityServer.address().port}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,mode:'approve'})})
    assert.equal(denied.status,401)
    for(const [actor,scope] of [['fixture-reviewer','tenant-admin'],['unprivileged','ops']]) {
      const response=await fetch(`http://127.0.0.1:${activityServer.address().port}/review`,{method:'POST',headers:{'content-type':'application/json','x-fixture-actor':actor,'x-fixture-scope':scope},body:JSON.stringify({...request,mode:'approve'})})
      assert.equal(response.status,403)
    }
    assert.equal((await control('/reconcile',{requestId:request.requestId,expectedRevision:2,resolution:approval})).status,409)
    assert.equal((await control('/reconcile',{requestId:request.requestId,expectedRevision:3,resolution:approval})).status,200)
    assert.equal((await (await control('/reconcile',{requestId:request.requestId,expectedRevision:3,resolution:approval})).json()).replayed,true)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activity').get().n,2)
    assert.equal(sqlite.prepare('SELECT status FROM activity').get().status,'settled')
    assert.equal((await pool.query('SELECT COUNT(*) n FROM enterprise_drain_activity_approvals'))[0][0].n,1)
    const activeRequest={...request,activityId:'lost-active',requestId:'activity-review-2'}
    assert.equal((await review({...activeRequest,mode:'approve'})).status,409)
    assert.equal((await control('/seal',{requestId:'still-active',expectedRevision:3,cutoverKey:'cutover-1',targetGeneration:'7'})).status,409)
    const ended={...decision,executionEndedReference:'fixture-worker-execution-ended',executionEndedEvidenceSha256:createHash('sha256').update('fixture execution terminated and provider completed').digest('hex')}
    const activeResponse=await review({...activeRequest,decision:ended,mode:'approve'}); assert.equal(activeResponse.status,200)
    const activeApproval=await activeResponse.json()
    assert.equal((await control('/reconcile',{requestId:activeRequest.requestId,expectedRevision:3,resolution:activeApproval})).status,200)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activity').get().n,2)
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM activity WHERE status='settled'").get().n,2)
    assert.equal((await control('/seal', { requestId: 'seal', expectedRevision: 3, cutoverKey: 'cutover-1', targetGeneration: '7' })).status, 200)
    const seal = await (await control('/snapshot')).json()
    const input = { tenantCode: 'C000001', environment: 'test', runtimeCode: 'runtime-1', cutoverKey: 'cutover-1', seal }
    await pool.execute("INSERT INTO enterprise_external_drain_approvals VALUES('C000001','test','cutover-1',4,?,REPEAT('d',64),'fixture-reviewer')",[createHash('sha256').update(seal.payload).digest('hex')])
    go = await startCutoverGoHttpFixture(rootDir, context.socketPath, 'isolated-control', createHash('sha256').update(seal.payload).digest('hex'))
    await pool.execute('UPDATE tenant_runtime_instances SET runtime_endpoint=?', [go.endpoint])
    await pool.execute('UPDATE deployments SET runtime_endpoint=?', [go.endpoint])
    const { useDbPool } = await import('../server/utils/db.ts'); appPool = useDbPool()
    const handler = (await import('../server/api/v1/runtime/cutover-activation.post.ts')).default
    httpServer = createServer(toNodeListener(createApp().use('/api/v1/runtime/cutover-activation', handler)))
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${httpServer.address().port}/api/v1/runtime/cutover-activation`
    async function signCommittedCutoverActivation(body, token) {
      const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw Error(result.message || result.statusMessage || `HTTP ${response.status}`)
      return result
    }
    const observed = await fetch(`${go.endpoint}/runtime/enterprise/cutover-activation`, { method: 'POST', headers: { authorization: 'Bearer business-token' }, body: JSON.stringify({ cutoverKey: 'cutover-1' }) })
    assert.equal(observed.status, 401)
    await assert.rejects(() => signCommittedCutoverActivation(input, 'business-token'), /HTTP 401/)
    await assert.rejects(() => signCommittedCutoverActivation({ ...input, seal: { ...seal, signature: 'f'.repeat(64) } }, 'isolated-control'), /HTTP 409/)
    await pool.query("UPDATE deployments SET runtime_endpoint='https://drift.invalid' WHERE app_code='assets'")
    await assert.rejects(() => signCommittedCutoverActivation(input, 'isolated-control'), /HTTP 409/)
    await pool.execute('UPDATE deployments SET runtime_endpoint=?', [go.endpoint])
    await pool.query("UPDATE enterprise_schema_registry SET generation=8")
    await assert.rejects(() => signCommittedCutoverActivation(input, 'isolated-control'), /HTTP 409/)
    await pool.query("UPDATE enterprise_schema_registry SET generation=7")
    const signed = await signCommittedCutoverActivation(input, 'isolated-control')
    assert.equal(verify(null, Buffer.from(signed.payload), key.publicKey, Buffer.from(signed.signature, 'base64url')), true)
    assert.deepEqual(JSON.parse(signed.payload).actors, actors)
    assert.equal(JSON.parse(signed.payload).sealRevision, 4)
    assert.equal((await control('/release', { requestId: 'release', expectedRevision: 4, activation: signed })).status, 200)
    const released = await (await control('/snapshot')).json()
    assert.equal(JSON.parse(released.payload).mode, 'open')
    console.log('Actual Go TLS HTTP + MySQL observation → Platform HTTP/DB route checks/signature → SQLite coordinator verified release passed; no transport mock')
  } finally {
    if (activityServer) await new Promise(resolve=>activityServer.close(resolve))
    if (httpServer) await new Promise(resolve => httpServer.close(resolve))
    if (go) await go.stop()
    if (sqlite) sqlite.close()
    if (appPool) await appPool.end()
    await pool.end(); directoryHook.deregister(); hooks.deregister()
    globalThis.useRuntimeConfig = original.config; globalThis.fetch = original.fetch
    for (const [name, value] of [['CUTOVER_TEST_KEY', original.key], ['HZY_DRAIN_CONTROL_TOKEN', original.drain]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
