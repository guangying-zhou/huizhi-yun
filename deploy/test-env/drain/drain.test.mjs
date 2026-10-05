import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { TestDrainCoordinator } from './coordinator.mjs'
import { withTestDrainBoundary } from './worker-boundary.mjs'

test('real SQLite persists closed admission, waitUntil/stream activity and uncertain crashes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-drain-'))
  const database = new DatabaseSync(join(dir, 'coordinator.sqlite'))
  const state = { storage: { sql: { exec(query, ...args) { const statement = database.prepare(query); return statement.columns().length ? statement.all(...args) : (statement.run(...args), []) } }, transactionSync(fn) { database.exec('BEGIN IMMEDIATE'); try { const result = fn(); database.exec('COMMIT'); return result } catch (error) { database.exec('ROLLBACK'); throw error } } } }
  const secrets = { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-app-token', HZY_DRAIN_CONTROL_TOKEN: 'fixture-control-token' }
  let coordinator = new TestDrainCoordinator(state, secrets)
  const actors = ['aims', 'assets'].map(app => ({ app, deployment: `C000001-test-${app}`, artifactSha256: 'a'.repeat(64) }))
  const call = async (path, body = {}, token = secrets.HZY_DRAIN_CONTROL_TOKEN) => coordinator.fetch(new Request(`https://fixture.invalid${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ tenant: 'C000001', environment: 'test', ...body }) }))
  const snapshot = async () => { const signed = await (await call('/snapshot')).json(); assert.equal(createHmac('sha256', secrets.HZY_DRAIN_CONTROL_TOKEN).update(signed.payload).digest('hex'), signed.signature); return JSON.parse(signed.payload) }
  const env = { ...secrets, HZY_DRAIN_COORDINATOR: { fetch: request => coordinator.fetch(request) } }
  try {
    const misconfigured = new TestDrainCoordinator(state, { ...secrets, HZY_DRAIN_CONTROL_TOKEN: secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN })
    assert.equal((await misconfigured.fetch(new Request('https://fixture.invalid/snapshot', { method: 'POST', headers: { authorization: `Bearer ${secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}` }, body: '{}' }))).status, 503)
    assert.equal((await call('/register', { requestId: 'register', actors })).status, 200)
    assert.equal((await call('/open', { requestId: 'wrong-privilege', expectedRevision: 1 }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 401)
    assert.equal((await call('/open', { requestId: 'open', expectedRevision: 1 })).status, 200)
    let finishBackground
    const background = new Promise(resolve => { finishBackground = resolve })
    const waits = []
    const worker = withTestDrainBoundary({ async fetch(request, env, ctx) { ctx.waitUntil(background); return new Response('actual response') } }, actors[0])
    const response = await worker.fetch(new Request('https://worker.invalid/aims/api/mutation'), env, { waitUntil: promise => waits.push(promise) })
    await call('/begin', { ...actors[1], id: 'lost-process' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)
    assert.equal((await call('/close', { requestId: 'close', expectedRevision: 2 })).status, 200)
    assert.equal((await worker.fetch(new Request('https://worker.invalid/direct-service-binding'), env, { waitUntil() {} })).status, 503)
    assert.equal((await snapshot()).ingressDrained, false)
    assert.equal((await call('/seal', { requestId: 'too-early', expectedRevision: 3, cutoverKey: 'cutover', targetGeneration: '7' })).status, 409)
    assert.equal(await response.text(), 'actual response')
    assert.equal((await snapshot()).ingressDrained, false)
    finishBackground()
    await Promise.all(waits)
    coordinator = new TestDrainCoordinator(state, secrets)
    assert.equal((await snapshot()).ingressDrained, false)
    assert.equal((await call('/finish', { ...actors[1], deployment: 'wrong', id: 'lost-process', admissionRevision: 2, outcome: 'settled' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 409)
    assert.equal((await call('/finish', { ...actors[1], artifactSha256: 'd'.repeat(64), id: 'lost-process', admissionRevision: 2, outcome: 'settled' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 409)
    for (const admissionRevision of [undefined, 1, 3, '2', 9007199254740992]) {
      assert.equal((await call('/finish', { ...actors[1], id: 'lost-process', admissionRevision, outcome: 'settled' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 409)
      assert.equal((await snapshot()).ingressDrained, false)
    }
    assert.equal((await call('/finish', { ...actors[1], id: 'lost-process', admissionRevision: 2, outcome: 'settled' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 200)
    assert.equal((await snapshot()).ingressDrained, true)
    assert.equal((await call('/seal', { requestId: 'seal', expectedRevision: 3, cutoverKey: 'cutover', targetGeneration: '7' })).status, 200)
    coordinator = new TestDrainCoordinator(state, secrets)
    assert.equal((await snapshot()).mode, 'sealed')
    assert.equal((await call('/open', { requestId: 'unsafe-open', expectedRevision: 4 })).status, 409)
    assert.equal((await call('/release', { requestId: 'release', expectedRevision: 4, activationReceiptHash: 'b'.repeat(64) })).status, 409)
    assert.equal((await call('/finish', { ...actors[0], artifactSha256: 'c'.repeat(64), id: 'forged', outcome: 'settled' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 409)
    const keys = generateKeyPairSync('ed25519')
    secrets.HZY_PLATFORM_SIGNING_KID = 'fixture-platform'
    secrets.HZY_PLATFORM_SIGNING_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' })
    const claims = { type: 'enterprise-drain-release.v1', runtimeCode: 'runtime-1', reviewHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), externalApprovalSha256: 'c'.repeat(64), tenant: 'C000001', environment: 'test', cutoverKey: 'cutover', sealRevision: 4, actors, generation: '7', expiresAt: new Date(Date.now() + 29000).toISOString() }
    const envelope = changes => { const payload = JSON.stringify({ ...claims, ...changes }); return { payload, kid: 'fixture-platform', alg: 'Ed25519', signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64url') } }
    for (const changes of [{ cutoverKey: 'wrong' }, { sealRevision: 3 }, { generation: '8' }, { actors: [actors[0], { ...actors[1], artifactSha256: 'f'.repeat(64) }] }, { expiresAt: new Date(0).toISOString() }]) {
      assert.equal((await call('/release', { requestId: 'reject', expectedRevision: 4, activation: envelope(changes) })).status, 409)
      assert.equal((await snapshot()).mode, 'sealed')
    }
    const tampered = envelope({}); tampered.payload += ' '
    assert.equal((await call('/release', { requestId: 'tampered', expectedRevision: 4, activation: tampered })).status, 409)
    assert.equal((await call('/release', { requestId: 'verified-release', expectedRevision: 4, activation: envelope({}) })).status, 200)
    assert.equal((await snapshot()).mode, 'open')

  } finally { database.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('test uncertain disposition is closed, hash-bound, atomic, and idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-drain-disposition-'))
  const database = new DatabaseSync(join(dir, 'coordinator.sqlite'))
  const state = { storage: { sql: { exec(query, ...args) { const statement = database.prepare(query); return statement.columns().length ? statement.all(...args) : (statement.run(...args), []) } }, transactionSync(fn) { database.exec('BEGIN IMMEDIATE'); try { const result = fn(); database.exec('COMMIT'); return result } catch (error) { database.exec('ROLLBACK'); throw error } } } }
  const secrets = { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-app-token', HZY_DRAIN_CONTROL_TOKEN: 'fixture-control-token' }
  const coordinator = new TestDrainCoordinator(state, secrets)
  const actor = { app: 'aims', deployment: 'C000001-test-aims', artifactSha256: 'a'.repeat(64) }
  const call = async (path, body = {}, token = secrets.HZY_DRAIN_CONTROL_TOKEN, tenant = 'C000001', environment = 'test') => coordinator.fetch(new Request(`https://fixture.invalid${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ tenant, environment, ...body }) }))
  try {
    assert.equal((await call('/register', { requestId: 'register-disposition', actors: [actor, { app: 'assets', deployment: 'C000001-test-assets', artifactSha256: 'b'.repeat(64) }] })).status, 200)
    assert.equal((await call('/open', { requestId: 'open-disposition', expectedRevision: 1 })).status, 200)
    await call('/begin', { ...actor, id: 'uncertain-disposition' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)
    await call('/finish', { ...actor, id: 'uncertain-disposition', admissionRevision: 2, outcome: 'uncertain', reason: 'fetch_complete' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)
    await call('/begin', { ...actor, id: 'active-disposition' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)
    assert.equal((await call('/close', { requestId: 'close-disposition', expectedRevision: 2 })).status, 200)
    const row = [...state.storage.sql.exec('SELECT * FROM activity WHERE id=?', 'uncertain-disposition')][0]
    const rowHash = createHash('sha256').update(JSON.stringify(row)).digest('hex')
    const base = { activityId: row.id, activitySha256: rowHash, expectedRevision: 3, ownerAuthorization: { reference: 'owner-test-evidence', evidenceSha256: 'c'.repeat(64) }, disposition: '测试窗口无外部副作用，保留审计记录。' }
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'wrong-tenant' }, secrets.HZY_DRAIN_CONTROL_TOKEN, 'OTHER', 'test')).status, 403)
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'wrong-environment' }, secrets.HZY_DRAIN_CONTROL_TOKEN, 'C000001', 'production')).status, 403)
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'wrong-token' }, secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)).status, 401)
    const activeRow = [...state.storage.sql.exec('SELECT * FROM activity WHERE id=?', 'active-disposition')][0]
    const activeHash = createHash('sha256').update(JSON.stringify(activeRow)).digest('hex')
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'active-request', activityId: 'active-disposition', activitySha256: activeHash })).status, 409)
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'hash-drift', activitySha256: 'd'.repeat(64) })).status, 409)
    assert.equal([...state.storage.sql.exec('SELECT status FROM activity WHERE id=?', 'uncertain-disposition')][0].status, 'uncertain')
    assert.equal([...state.storage.sql.exec('SELECT status FROM activity WHERE id=?', 'active-disposition')][0].status, 'active')
    database.exec("CREATE TRIGGER fail_disposition_audit BEFORE INSERT ON audit WHEN NEW.id='audit-failure' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'audit-failure' })).status, 503)
    assert.equal([...state.storage.sql.exec('SELECT status FROM activity WHERE id=?', row.id)][0].status, 'uncertain')
    database.exec('DROP TRIGGER fail_disposition_audit')
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'resolve-disposition' })).status, 200)
    const audit = [...state.storage.sql.exec('SELECT payload,result FROM audit WHERE id=?', 'resolve-disposition')][0]
    assert.equal(JSON.parse(audit.payload).activitySha256, rowHash)
    assert.equal(JSON.parse(audit.result).activity.id, 'uncertain-disposition')
    assert.equal(JSON.parse(audit.result).ownerAuthorization.evidenceSha256, 'c'.repeat(64))
    assert.equal(JSON.parse(audit.result).disposition, base.disposition)
    assert.equal((await (await call('/resolve-test-uncertain', { ...base, requestId: 'resolve-disposition' })).json()).replayed, true)
    assert.equal((await call('/resolve-test-uncertain', { ...base, requestId: 'resolve-disposition', disposition: '不同说明导致同请求重放冲突并拒绝再次变更。' })).status, 409)
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }) }
})
