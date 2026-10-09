import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise document shares bind owner actor, exact permits and retry keys', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], notifications = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'owner-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__shareSession', '__shareAuth', '__shareTransport', '__sharePrepare', '__shareNotify'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__shareSession = session
  globalThis.__shareAuth = { resources: { documents: ['edit'] }, actionPolicies: {} }
  globalThis.__sharePrepare = async () => true
  globalThis.__shareNotify = async (input) => {
    notifications.push(input)
    return true
  }
  globalThis.__shareTransport = async (_event, path, options) => {
    calls.push({ path, options })
    if (path.endsWith(':list')) return { handled: true, data: { success: true, data: { items: [{ id: 7, shared_to_uid: 'user-b', permission: 'read' }] } } }
    if (path.endsWith(':create')) return { handled: true, data: { success: true, data: { shareId: 7, documentTitle: 'Plan', ownerUid: 'owner-a', targetUid: 'user-b', permission: options.body.payload.permission } } }
    return { handled: true, data: { success: true, data: { changed: true } } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__shareSession'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__sharePrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__shareTransport(...args)'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__shareAuth'
    if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
    if (specifier.endsWith('/directoryApi')) source = 'export const fetchConsoleDirectoryApi=async()=>({data:[{uid:"user-b",realName:"User B",deptName:"Sales"}]})'
    if (specifier.endsWith('/notify')) source = 'export const sendNotification=(...args)=>globalThis.__shareNotify(...args)'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    router.get('/documents/:uuid/shares', (await import('../server/routes/codocs/api/documents/[uuid]/shares.get.ts')).default)
    router.post('/documents/:uuid/read', (await import('../server/routes/codocs/api/documents/[uuid]/read.post.ts')).default)
    router.post('/documents/:uuid/shares', (await import('../server/routes/codocs/api/documents/[uuid]/shares.post.ts')).default)
    router.patch('/documents/:uuid/shares/:shareId', (await import('../server/routes/codocs/api/documents/[uuid]/shares/[shareId].patch.ts')).default)
    router.delete('/documents/:uuid/shares/:shareId', (await import('../server/routes/codocs/api/documents/[uuid]/shares/[shareId].delete.ts')).default)
    app.use(defineEventHandler((event) => {
      event.context.consoleAuth = globalThis.__shareSession
    }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`, headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'share-attempt-0001' }
    const listed = await fetch(`${base}/documents/doc-1/shares`)
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data[0].real_name, 'User B')
    const beforeSelf = calls.length
    const self = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers, body: JSON.stringify({ sharedToUid: 'owner-a', permission: 'read' }) })
    assert.equal(self.status, 400)
    assert.equal((await self.json()).data.code, 'share_self_not_allowed')
    assert.equal(calls.length, beforeSelf)
    assert.equal(notifications.length, 0)
    const created = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers, body: JSON.stringify({ sharedToUid: 'user-b', permission: 'write', message: 'review' }) })
    assert.equal(created.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/document-shares:create')
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'owner-a')
    assert.equal(calls.at(-1).options.body.authorization.action, 'create')
    assert.equal(calls.at(-1).options.idempotencyKey, 'share-attempt-0001')
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].sourceAppCode, 'enterprise')
    assert.deepEqual(notifications[0].metadata.moduleAppCode, 'codocs')
    assert.equal(notifications[0].metadata.notificationKind, 'business_event')
    assert.equal(notifications[0].metadata.actionableState, undefined)
    assert.equal(notifications[0].url, '/codocs/documents/doc-1')
    assert.equal(notifications[0].idempotencyKey, 'codocs:document-shared:7:write')
    const diagnostics = []
    const originalWarn = console.warn
    const originalNotify = globalThis.__shareNotify
    try {
      console.warn = (...args) => diagnostics.push(args)
      globalThis.__shareNotify = async (input) => {
        notifications.push(input)
        throw { result: { inApp: { status: 'rejected', reason: { statusCode: 403, data: { code: 'insufficient_scope', token: 'never-log-token' }, message: 'never-log-recipient' } }, external: { status: 'skipped' } } }
      }
      const recoveryHeaders = { ...headers, 'Idempotency-Key': 'share-notification-recovery-0001' }
      const body = JSON.stringify({ sharedToUid: 'user-b', permission: 'write', message: 'review' })
      const partial = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers: recoveryHeaders, body })
      assert.equal(partial.status, 403)
      const partialResult = await partial.json()
      assert.equal(partialResult.data.code, 'document_share_notification_unavailable')
      assert.equal(partialResult.data.retryable, false)
      assert.equal(partialResult.data.sharedPersisted, true)
      assert.match(partialResult.data.message, /共享已保存/)
      assert.equal(calls.at(-1).options.idempotencyKey, recoveryHeaders['Idempotency-Key'])
      assert.deepEqual(diagnostics[0], ['[codocs-share-notification-failed]', { stage: 'notification_in_app', httpStatus: 403, errorCode: 'insufficient_scope' }])
      assert.doesNotMatch(JSON.stringify(diagnostics), /never-log|user-b|owner-a|Plan/)
      const failedNotificationKey = notifications.at(-1).idempotencyKey
      globalThis.__shareNotify = async () => ({ external: { status: 'skipped', reason: 'external_identity_missing' }, externalSkipped: { count: 1, reasons: ['external_identity_missing'] } })
      const skipped = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers: recoveryHeaders, body })
      assert.equal(skipped.status, 200)
      assert.deepEqual((await skipped.json()).data.notification, { externalStatus: 'skipped', reason: 'external_identity_missing' })
      globalThis.__shareNotify = async () => {
        throw { result: { external: { status: 'rejected', reason: { statusCode: 502, data: { code: 'wecom_send_request_failed' } } } } }
      }
      const temporary = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers: recoveryHeaders, body })
      assert.equal(temporary.status, 503)
      assert.equal((await temporary.json()).data.retryable, true)
      globalThis.__shareNotify = originalNotify
      const recovered = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers: recoveryHeaders, body })
      assert.equal(recovered.status, 200)
      assert.equal(calls.at(-1).options.idempotencyKey, recoveryHeaders['Idempotency-Key'])
      assert.equal(notifications.at(-1).idempotencyKey, failedNotificationKey)
    } finally {
      console.warn = originalWarn
      globalThis.__shareNotify = originalNotify
    }
    const updated = await fetch(`${base}/documents/doc-1/shares/7`, { method: 'PATCH', headers, body: JSON.stringify({ permission: 'read' }) })
    assert.equal(updated.status, 200)
    assert.equal(calls.at(-1).options.body.code, 'doc-1/7')
    const deleted = await fetch(`${base}/documents/doc-1/shares/7`, { method: 'DELETE', headers })
    assert.equal(deleted.status, 200)
    assert.equal(calls.at(-1).options.body.authorization.action, 'delete')
    const revokeWithHeaders = (extraHeaders, body) => new Promise((resolve, reject) => {
      const req = request(`${base}/documents/doc-1/shares/7`, {
        method: 'DELETE', headers: { 'Idempotency-Key': 'share-attempt-0002', ...extraHeaders }
      }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', reject)
      req.end(body)
    })
    assert.equal(await revokeWithHeaders({ 'Content-Length': '0' }), 200)
    assert.equal(await revokeWithHeaders({ 'Transfer-Encoding': 'chunked' }), 200)
    const beforeRejectedBody = calls.length
    assert.equal(await revokeWithHeaders({ 'Content-Type': 'application/json', 'Content-Length': '2' }, '{}'), 400)
    assert.equal(calls.length, beforeRejectedBody, 'nonempty revoke body must not reach Runtime')
    const before = calls.length
    const injected = await fetch(`${base}/documents/doc-1/shares`, { method: 'POST', headers, body: JSON.stringify({ sharedToUid: 'user-b', permission: 'read', actorUid: 'victim' }) })
    assert.equal(injected.status, 400)
    assert.equal(calls.length, before)
    session.uid = 'user-b'
    globalThis.__shareAuth = { resources: { documents: ['view'] }, actionPolicies: {} }
    const shareeList = await fetch(`${base}/documents/doc-1/shares`)
    assert.equal(shareeList.status, 403)
    assert.equal(calls.length, before, 'sharee must not receive the owner-only list')
    const marked = await fetch(`${base}/documents/doc-1/read`, { method: 'POST', headers })
    assert.equal(marked.status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/codocs/document-shares:mark-read')
    assert.equal(calls.at(-1).options.body.authorization.actorUid, 'user-b')
    assert.equal(calls.at(-1).options.body.authorization.action, 'mark-read')
    assert.equal(calls.at(-1).options.body.code, 'doc-1')
    assert.equal(calls.at(-1).options.body.payload, undefined)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})

test('Codocs failure logs decode notification-runtime closed error envelopes without logging payloads', async () => {
  const { codocsNotificationFailureDiagnostics } = await import('../server/utils/codocsNotificationFailure.ts')
  const rows = codocsNotificationFailureDiagnostics({ result: { external: { status: 'rejected', reason: {
    statusCode: 502, data: { code: -1, data: { error: 'wecom_send_error', recipient: 'private-user' } }, message: 'private-message'
  } } } })
  assert.deepEqual(rows, [{ stage: 'notification_external', httpStatus: 502, errorCode: 'wecom_send_error' }])
  assert.doesNotMatch(JSON.stringify(rows), /private/)
})
