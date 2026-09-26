import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener } from 'h3'

// Only remote service/session boundaries are fixtures. H3 parsing, Aims input
// validation, product facts binding, scope evaluation and Host transport mapping
// below execute their production modules. This is not an OIDC/signature test.
test('real H3 feature bridge preserves validation, secondary permissions and scoped identity', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false
  let resourceDenied = false, authorizationUnavailable = false
  const calls = [], checks = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__planningSession = session
  globalThis.__planningTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith('/product-authorization')
      ? { product_code: options.body.productCode, actor_uid: session.uid, revision: 3, status: 'active', is_member: true, is_manager: false }
      : { receipt_id: 'receipt-fixture', scope_revision: 2 } } }
  }
  globalThis.__planningAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    const permission = `${required.resourceCode}:${required.action}`
    return { grants: permission === denied ? [] : [{ grantId: 'explicit-person-grant', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'product', predicate: 'code', value: wrongScope ? 'P-B' : 'P-A' }] }] }
  }
  globalThis.__planningSnapshot = async () => {
    if (authorizationUnavailable) throw createError({ statusCode: 503, message: 'Console unavailable' })
    return { resources: { product_priorities: resourceDenied ? [] : ['view'], products: resourceDenied ? [] : ['view'] }, actionPolicies: {} }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge = async () => globalThis.__planningSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime = (...args) => globalThis.__planningTransport(...args); export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime = async () => true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime = (...args) => globalThis.__planningAuthorization(...args); export const loadAuthorizationSnapshotFromConsoleRuntime = (...args) => globalThis.__planningSnapshot(...args)'
      if (specifier.endsWith('/assetsScopedAuthorizationCore')) source = 'export const assetsObjectScopeFromScopedAuthorization = () => ({ access: \'all\' }); export const assetsObjectScopeQuery = () => ({ access: \'all\' })'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })
  let server
  try {
    const { enterpriseProductFeatureBridge: bridge } = await import('../server/utils/enterpriseProductFeatures.ts')
    const { handleProductFeatureCreate: create } = await import('../../aims/server/utils/productFeatureCreateRuntime.ts')
    const { handleProductFeatureRequests: requests } = await import('../../aims/server/utils/productFeatureRequestRuntime.ts')
    const cycles = (await import('../server/routes/aims/api/v1/products/[productCode]/planning-cycles.get.ts')).default
    const adoption = (await import('../server/routes/aims/api/v1/products/[productCode]/adoption.get.ts')).default
    const app = createApp()
    const router = createRouter()
    app.use(defineEventHandler((e) => {
      e.context.consoleAuth = session
    }))
    router.post('/products/:productCode/features', defineEventHandler(async e => create(e, await bridge(e))))
    router.post('/products/:productCode/features/:featureId/requests', defineEventHandler(async e => requests(e, 'change', await bridge(e))))
    router.get('/products/:productCode/planning-cycles', cycles)
    router.get('/products/:productCode/roadmaps/adoption', adoption)
    router.post('/unsupported', defineEventHandler(async e => (await bridge(e)).call('P-A', 'unregistered', {})))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    const post = async (path, body, key = 'feature-key') => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-hzy-tenant': 'forged' }, body: JSON.stringify(body) })
    const draft = { expectedRevision: 3, title: 'Login' }
    for (const body of [{ ...draft, tenant: 'forged' }, { ...draft, title: '' }]) assert.equal((await post('/products/P-A/features', body)).status, 400)
    assert.equal((await post('/products/P-A/features', draft, '')).status, 400)
    denied = 'product_features:edit'
    assert.ok([403, 404].includes((await post('/products/P-A/features', draft)).status))
    denied = ''
    wrongScope = true
    assert.ok([403, 404].includes((await post('/products/P-A/features', draft)).status))
    wrongScope = false
    calls.length = 0
    assert.equal((await post('/products/P-A/features', draft)).status, 200)
    const sent = calls.find(c => c.path.endsWith('features:create'))
    assert.equal(sent.options.appCode, 'enterprise')
    assert.equal(sent.options.scope, 'aims:product-features:create')
    assert.equal(sent.options.body.tenant, 'tenant-a')
    assert.equal(sent.options.body.deployment, 'enterprise-test')
    assert.equal(sent.options.body.authorization.facts.actor_uid, 'person-a')
    assert.equal(sent.options.idempotencyKey, 'feature-key')
    const feature = '00000000-0000-4000-8000-000000000001'
    const link = { expectedRevision: 3, expectedFeatureRevision: 1, expectedRequestRevision: 1, requestBizId: '00000000-0000-4000-8000-000000000002', operation: 'link', reason: 'Scope' }
    for (const permission of ['product_requests:edit', 'product_features:view']) {
      denied = permission
      const before = calls.filter(c => c.path.endsWith('features:request-link')).length
      assert.ok([403, 404].includes((await post(`/products/P-A/features/${feature}/requests`, link)).status))
      assert.equal(calls.filter(c => c.path.endsWith('features:request-link')).length, before)
    }
    denied = ''
    assert.equal((await post(`/products/P-A/features/${feature}/requests`, link)).status, 200)
    const linked = calls.find(c => c.path.endsWith('features:request-link'))
    assert.equal(linked.options.body.request_authorization.action, 'edit')
    assert.equal(linked.options.body.feature_authorization.action, 'view')
    const cyclesPath = base + '/products/P-A/planning-cycles'
    resourceDenied = true
    let before = calls.length
    assert.equal((await fetch(cyclesPath)).status, 403)
    assert.equal(calls.length, before)
    resourceDenied = false
    authorizationUnavailable = true
    before = calls.length
    assert.equal((await fetch(cyclesPath)).status, 503)
    assert.equal(calls.length, before)
    authorizationUnavailable = false
    assert.equal((await fetch(cyclesPath + '?page=0')).status, 400)
    denied = 'product_priorities:view'
    before = calls.filter(c => c.path.endsWith('features:cycles')).length
    assert.equal((await fetch(cyclesPath)).status, 404)
    assert.equal(calls.filter(c => c.path.endsWith('features:cycles')).length, before)
    denied = ''
    wrongScope = true
    assert.equal((await fetch(cyclesPath)).status, 404)
    wrongScope = false
    assert.equal((await fetch(cyclesPath)).status, 200)
    const cycleCall = calls.find(c => c.path.endsWith('features:cycles'))
    assert.equal(cycleCall.options.body.authorization.facts.actor_uid, 'person-a')
    const adoptionPath = base + '/products/P-A/roadmaps/adoption'
    resourceDenied = true
    before = calls.length
    assert.equal((await fetch(adoptionPath)).status, 403)
    assert.equal(calls.length, before)
    resourceDenied = false
    authorizationUnavailable = true
    before = calls.length
    assert.equal((await fetch(adoptionPath)).status, 503)
    assert.equal(calls.length, before)
    authorizationUnavailable = false
    assert.equal((await fetch(adoptionPath + '?page=0')).status, 400)
    denied = 'products:view'
    before = calls.filter(c => c.path.endsWith('product-adoption:read')).length
    assert.equal((await fetch(adoptionPath)).status, 404)
    assert.equal(calls.filter(c => c.path.endsWith('product-adoption:read')).length, before)
    denied = ''
    assert.equal((await fetch(adoptionPath)).status, 200)
    const adoptionCall = calls.find(c => c.path.endsWith('product-adoption:read'))
    assert.equal(adoptionCall.options.body.deliveryAuthorization.actorUid, 'person-a')
    assert.equal(adoptionCall.options.body.environmentAuthorization.tenant, 'tenant-a')
    assert.equal((await post('/unsupported', {})).status, 503)
  } finally {
    if (server) await new Promise(r => server.close(r))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__planningSession
    delete globalThis.__planningTransport
    delete globalThis.__planningAuthorization
    delete globalThis.__planningSnapshot
  }
})
