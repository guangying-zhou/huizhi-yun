import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise publish execution uses exact action permits and durable notifications', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = [], notifications = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const old = Object.fromEntries(['useRuntimeConfig', 'defineEventHandler', '__publishSession', '__publishAuth', '__publishTransport', '__publishPrepare', '__publishNotify'].map(key => [key, globalThis[key]]))
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__publishSession = session
  globalThis.__publishAuth = { resources: { reviews: ['admin', 'archive', 'view'] }, actionPolicies: {} }
  globalThis.__publishPrepare = async () => true
  globalThis.__publishTransport = async (_event, path, options) => {
    calls.push({ path, options })
    const action = path.split(':').at(-1)
    return { handled: true, data: { success: true, data: { executionStatus: action === 'seal' ? 'pending_send' : action === 'send' ? 'pending_receive' : 'received', idempotent: false, initiatorUid: 'person-a', senderUid: 'person-b', documentTitle: 'Notice' } } }
  }
  globalThis.__publishNotify = async input => { notifications.push(input); if (globalThis.__publishNotifyFail) throw Object.assign(new Error('private notify error'), { statusCode: 502 }) }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__publishSession'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__publishPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__publishTransport(...args)'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__publishAuth'
    if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
    if (specifier.endsWith('/notify')) source = 'export const sendNotification=(...args)=>globalThis.__publishNotify(...args)'
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
    router.post('/reviews/:id/seal', (await import('../server/routes/codocs/api/reviews/[id]/seal.post.ts')).default)
    router.post('/reviews/:id/send', (await import('../server/routes/codocs/api/reviews/[id]/send.post.ts')).default)
    router.post('/reviews/:id/receive', (await import('../server/routes/codocs/api/reviews/[id]/receive.post.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__publishSession })); app.use(router)
    server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (action, body, key = `publish-${action}-key`) => fetch(`${base}/reviews/42/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
    const bodies = { seal: { sealTypes: ['official'], pageCount: 2, remark: null }, send: { senderUid: 'person-b', receiverName: 'Receiver', receiverPhone: '123', channel: 'email', sentDate: '2026-09-19', targetAccount: 'a@example.test', remark: null }, receive: { receiveDate: '2026-09-19' } }
    for (const action of ['seal', 'send', 'receive']) {
      const notificationsBefore = notifications.length
      const response = await post(action, bodies[action]); assert.equal(response.status, 200, action)
      assert.equal(calls.at(-1).path, `/v1/enterprise/codocs/publish-execution:${action}`)
      assert.equal(calls.at(-1).options.scope, `codocs:publish-execution:${action}`)
      assert.equal(calls.at(-1).options.body.authorization.actorUid, 'person-a')
      assert.equal(calls.at(-1).options.body.authorization.action, action)
      assert.equal(calls.at(-1).options.idempotencyKey, `publish-${action}-key`)
      assert.equal(notifications[notificationsBefore].sourceAppCode, 'enterprise')
      assert.equal(notifications[notificationsBefore].metadata.moduleAppCode, 'codocs')
      assert.equal(notifications[notificationsBefore].metadata.notificationKind, 'business_event')
      assert.equal(notifications[notificationsBefore].metadata.actionableState, undefined)
      assert.equal(notifications[notificationsBefore].url, '/codocs/mydocs/shared')
      assert.match(notifications[notificationsBefore].idempotencyKey, new RegExp(`^codocs:publish-${action}:`))
      assert.equal(notifications.length - notificationsBefore, action === 'send' ? 2 : 1)
      if (action === 'send') {
        assert.deepEqual(notifications[notificationsBefore].touser, ['person-a'])
        assert.deepEqual(notifications[notificationsBefore + 1].touser, ['person-b'])
        assert.equal(notifications[notificationsBefore + 1].sourceAppCode, 'enterprise')
        assert.equal(notifications[notificationsBefore + 1].metadata.moduleAppCode, 'codocs')
        assert.equal(notifications[notificationsBefore + 1].metadata.notificationKind, 'business_event')
        assert.equal(notifications[notificationsBefore + 1].metadata.actionableState, undefined)
        assert.equal(notifications[notificationsBefore + 1].url, '/codocs/mydocs/shared')
        assert.match(notifications[notificationsBefore + 1].idempotencyKey, /^codocs:publish-receive-pending:/)
      }
    }
    globalThis.__publishAuth = { resources: { reviews: ['view'] }, actionPolicies: {} }
    const before = calls.length; assert.equal((await post('seal', bodies.seal)).status, 403); assert.equal(calls.length, before)
    globalThis.__publishAuth = { resources: { reviews: ['admin', 'archive', 'view'] }, actionPolicies: {} }
    assert.equal((await post('seal', { ...bodies.seal, current_user: 'victim' })).status, 400)
    assert.equal((await post('receive', bodies.receive, 'short')).status, 400)
    globalThis.__publishNotifyFail = true
    const failed = await post('receive', bodies.receive, 'publish-receive-notify-retry')
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private notify error/)
  } finally {
    if (server) await new Promise(done => server.close(done)); hooks.deregister()
    delete globalThis.__publishNotifyFail
    for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})
