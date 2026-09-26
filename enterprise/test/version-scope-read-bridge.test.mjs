import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Host version scope reads validate input and person permission before issuing a Runtime call', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false
  const calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__planningSession = session
  globalThis.__planningTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith('/product-authorization')
      ? { product_code: options.body.productCode, actor_uid: session.uid, revision: 3, status: 'active', is_member: true, is_manager: false }
      : { items: [], total: 0, page: 1, pageSize: 20 } } }
  }
  globalThis.__planningAuthorization = async (_event, _uid, app, required) => ({ grants: `${required.resourceCode}:${required.action}` === denied ? [] : [{ grantId: 'grant', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'product', predicate: 'code', value: wrongScope ? 'P-B' : 'P-A' }] }] })
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge = async () => globalThis.__planningSession'
    if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime = (...args) => globalThis.__planningTransport(...args); export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime = async () => true'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime = (...args) => globalThis.__planningAuthorization(...args)'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseProductPlanningBridge: bridge } = await import('../server/utils/enterpriseProductPlanning.ts')
    const { handleProductVersionScope: scope } = await import('../../aims/server/utils/productVersionScopeRuntime.ts')
    const app = createApp(), router = createRouter()
    app.use(defineEventHandler((event) => {
      event.context.consoleAuth = session
    }))
    router.get('/products/:productCode/versions/:versionId/features', defineEventHandler(async event => scope(event, 'list', await bridge(event))))
    router.get('/products/:productCode/versions/:versionId/features/:scopeId/history', defineEventHandler(async event => scope(event, 'history', await bridge(event))))
    router.post('/products/:productCode/versions/:versionId/features/:scopeId/deliver', defineEventHandler(async event => scope(event, 'deliver', await bridge(event))))
    router.post('/products/:productCode/versions/:versionId/features/:scopeId/reopen', defineEventHandler(async event => scope(event, 'reopen', await bridge(event))))
    router.patch('/products/:productCode/versions/:versionId/features/:scopeId', defineEventHandler(async event => scope(event, 'edit', await bridge(event))))
    router.post('/products/:productCode/versions/:versionId/features/:scopeId/visibility', defineEventHandler(async event => scope(event, 'visibility', await bridge(event))))
    router.post('/products/:productCode/versions/:versionId/features/:scopeId/legacy-criteria', defineEventHandler(async event => scope(event, 'legacy-criteria', await bridge(event))))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/products/P-A/versions/5/features`
    for (const path of ['?page=0', '?tenant=other', '?pageSize=101', '/0/history', '/1/history?keyword=x']) {
      const before = calls.length
      assert.equal((await fetch(base + path)).status, 400)
      assert.equal(calls.length, before)
    }
    denied = 'product_versions:view'
    const beforeDenied = calls.length
    assert.ok([403, 404].includes((await fetch(base)).status))
    assert.equal(calls.slice(beforeDenied).filter(call => call.path.includes('scope-list')).length, 0)
    denied = ''
    wrongScope = true
    const beforeWrongScope = calls.length
    assert.ok([403, 404].includes((await fetch(base + '/1/history')).status))
    assert.equal(calls.slice(beforeWrongScope).filter(call => call.path.includes('scope-history')).length, 0)
    wrongScope = false
    for (const [path, action] of [['?page=2&pageSize=10&keyword=a', 'scope-list'], ['/7/history?page=3&pageSize=9', 'scope-history']]) {
      const response = await fetch(base + path)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const sent = calls.findLast(call => call.path.endsWith('product-version:' + action))
      assert.ok(sent)
      assert.equal(sent.options.scope, 'aims:product-versions:read')
      assert.equal(sent.options.body.authorization.action, 'view')
      assert.equal(sent.options.body.authorization.facts.actor_uid, 'person-a')
      assert.equal(sent.options.body.input.version_id, 5)
      assert.equal(sent.options.body.input.page, action === 'scope-list' ? 2 : 3)
      assert.equal(sent.options.body.input.page_size, action === 'scope-list' ? 10 : 9)
      assert.equal(sent.options.body.input.scope_id, action === 'scope-history' ? 7 : undefined)
    }
    const deliveryBody = { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 2, evidence: 'test record', reason: 'accepted' }
    const post = (path, body, key = 'scope-test-key') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
    const beforeInvalid = calls.length
    assert.equal((await post('/7/deliver?tenant=other', deliveryBody)).status, 400)
    assert.equal((await post('/0/deliver', deliveryBody)).status, 400)
    assert.equal(calls.length, beforeInvalid)
    denied = 'product_versions:accept'
    const beforeDeniedWrite = calls.length
    assert.equal((await post('/7/deliver', deliveryBody)).status, 403)
    assert.equal(calls.slice(beforeDeniedWrite).filter(call => call.path.includes('scope-deliver')).length, 0)
    denied = ''
    for (const [action, body] of [['deliver', deliveryBody], ['reopen', { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 2, reason: 'correction' }]]) {
      const response = await post(`/7/${action}`, body, `scope-${action}-key`)
      assert.equal(response.status, 200)
      const sent = calls.findLast(call => call.path.endsWith(`product-version:scope-${action}`))
      assert.ok(sent)
      assert.equal(sent.options.scope, `aims:product-versions:scope-${action}`)
      assert.equal(sent.options.idempotencyKey, `scope-${action}-key`)
      assert.equal(sent.options.body.authorization.action, 'accept')
      assert.equal(sent.options.body.authorization.facts.actor_uid, 'person-a')
      assert.equal(sent.options.body.input.version_id, 5)
      assert.equal(sent.options.body.input.scope_id, 7)
    }
    const editBody = { itemBizId: '00000000-0000-4000-8000-000000000001', cycleBizId: '00000000-0000-4000-8000-000000000002', expectedRevision: 3, expectedItemRevision: 1, expectedCycleRevision: 1, expectedQueueRevision: 1, expectedVersionRevision: 2, title: 'Marked scope', description: '', acceptanceCriteria: 'Marked acceptance', changeType: 'new', reason: 'Marked correction' }
    const edit = (body = editBody, key = 'scope-edit-key') => fetch(base + '/7', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) })
    const beforeInvalidEdit = calls.length
    assert.equal((await edit({ ...editBody, tenant: 'other' }, 'scope-edit-invalid')).status, 400)
    assert.equal(calls.length, beforeInvalidEdit)
    denied = 'product_priorities:prioritize'
    const beforePlanningDenied = calls.length
    assert.equal((await edit()).status, 403)
    assert.equal(calls.slice(beforePlanningDenied).filter(call => call.path.endsWith('product-version:scope-edit')).length, 0)
    denied = ''
    assert.equal((await edit()).status, 200)
    const editCall = calls.findLast(call => call.path.endsWith('product-version:scope-edit'))
    assert.equal(editCall.options.scope, 'aims:product-versions:scope-edit')
    assert.equal(editCall.options.idempotencyKey, 'scope-edit-key')
    assert.equal(editCall.options.body.authorization.action, 'edit')
    assert.equal(editCall.options.body.planning_authorization.resource, 'product_priorities')
    assert.equal(editCall.options.body.planning_authorization.action, 'prioritize')
    assert.equal(editCall.options.body.planning_authorization.facts.actor_uid, 'person-a')
    assert.equal(editCall.options.body.input.scope_id, 7)
    for (const [action, body] of [['visibility', { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 2, isPublic: false, reason: 'Marked private scope' }], ['legacy-criteria', { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 2, acceptanceCriteria: 'Marked criteria', reason: 'Marked legacy update' }]]) {
      denied = 'product_versions:edit'
      const beforeDenied = calls.length
      assert.equal((await post(`/7/${action}`, body, `scope-${action}-denied`)).status, 403)
      assert.equal(calls.slice(beforeDenied).filter(call => call.path.endsWith(`product-version:scope-${action}`)).length, 0)
      denied = ''
      assert.equal((await post(`/7/${action}`, body, `scope-${action}-key`)).status, 200)
      const sent = calls.findLast(call => call.path.endsWith(`product-version:scope-${action}`))
      assert.equal(sent.options.scope, `aims:product-versions:scope-${action}`)
      assert.equal(sent.options.body.authorization.action, 'edit')
      assert.equal(sent.options.body.planning_authorization, undefined)
      assert.equal(sent.options.body.input.scope_id, 7)
      assert.equal(sent.options.idempotencyKey, `scope-${action}-key`)
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__planningSession
    delete globalThis.__planningTransport
    delete globalThis.__planningAuthorization
  }
})
