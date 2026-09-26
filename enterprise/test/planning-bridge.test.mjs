import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

// Only remote service/session boundaries are fixtures. H3 parsing, Aims input
// validation, product facts binding, scope evaluation and Host transport mapping
// below execute their production modules. This is not an OIDC/signature test.
test('real H3 planning bridge preserves validation, secondary authorization and Host identity', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false
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
  const hooks = registerHooks({
    resolve(specifier, context, next) {
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
    }
  })
  let server
  try {
    const { enterpriseProductRequestActions } = await import('../server/utils/enterpriseProductRequestActions.ts')
    const { handleProductRequestAction } = await import('../../aims/server/utils/productRequestActionRuntime.ts')
    const { handleProductRequestRead } = await import('../../aims/server/utils/productRequestReadRuntime.ts')
    const { enterpriseProductComponents } = await import('../server/utils/enterpriseProductComponents.ts')
    const { enterpriseProductPlanningBridge } = await import('../server/utils/enterpriseProductPlanning.ts')
    const { handleProductLightweightPlan } = await import('../../aims/server/utils/productLightweightPlanRuntime.ts')
    const { handleProductVersionCollection } = await import('../../aims/server/utils/productVersionRuntime.ts')
    const router = createRouter(), app = createApp()
    app.use(defineEventHandler((event) => {
      event.context.consoleAuth = session
    }))
    router.post('/products/:productCode/versions', defineEventHandler(async e => handleProductVersionCollection(e, 'create', await enterpriseProductPlanningBridge(e))))
    for (const [suffix, action] of [['plan', 'edit'], ['plan/items', 'item-create'], ['plan/confirm', 'confirm']]) {
      router.post(`/products/:productCode/versions/:versionId/${suffix}`, defineEventHandler(async e => handleProductLightweightPlan(e, action, await enterpriseProductPlanningBridge(e))))
    }
    router.post('/products/:productCode/versions/:versionId/unsupported', defineEventHandler(async e => (await enterpriseProductPlanningBridge(e)).call('P-A', 'unsupported-action', {})))
    router.get('/products/:productCode/versions', defineEventHandler(async e => handleProductVersionCollection(e, 'list', await enterpriseProductPlanningBridge(e))))
    router.get('/products/:productCode/versions/:versionId', defineEventHandler(async e => handleProductVersionCollection(e, 'view', await enterpriseProductPlanningBridge(e))))
    router.get('/products/:productCode/versions/:versionId/plan', defineEventHandler(async e => handleProductLightweightPlan(e, 'read', await enterpriseProductPlanningBridge(e))))
    router.get('/products/:productCode/versions/:versionId/plan/items', defineEventHandler(async e => handleProductLightweightPlan(e, 'item-list', await enterpriseProductPlanningBridge(e))))
    router.get('/products/:productCode/components', defineEventHandler(enterpriseProductComponents))
    for (const action of ['create', 'edit', 'move', 'delete']) router.post(`/products/:productCode/components/:componentId/${action}`, defineEventHandler(e => enterpriseProductComponents(e, action)))
    for (const action of ['merge', 'edit', 'decide', 'source-create', 'source-delete']) router.post(`/products/:productCode/requests/:requestId/${action}/:sourceId`, defineEventHandler(async e => handleProductRequestAction(e, action, await enterpriseProductRequestActions(e))))
    router.get('/products/:productCode/requests/:requestId/sources', defineEventHandler(async e => handleProductRequestRead(e, 'sources', await enterpriseProductRequestActions(e))))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, body, key = 'client-command-1') => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-hzy-actor-uid': 'forged', 'x-hzy-tenant': 'forged-tenant' }, body: JSON.stringify(body) })
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }
    }
    const item = { expectedRevision: 3, expectedVersionRevision: 2, expectedPlanRevision: 1, expectedRequestRevision: 1, requestBizId: '00000000-0000-4000-8000-000000000001', scopeSummary: 'Login', estimatePersonDays: '2.50', acceptanceCriteria: 'Login succeeds', sortOrder: 0, adoptRequest: true }
    const path = '/products/P-A/versions/12/plan/items'
    for (const [url, body, key] of [[path, { ...item, tenant: 'forged' }, 'key'], [path, item, ''], ['/products/P-A/versions/0/plan/items', item, 'key'], [path + '?actor=forged', item, 'key'], [path, { ...item, estimatePersonDays: 'NaN' }, 'key']]) {
      const before = calls.length
      assert.equal((await request(url, body, key)).status, 400)
      assert.equal(calls.length, before, 'invalid browser input must not load facts or send command')
    }
    for (const permission of ['product_requests:view', 'product_requests:decide', 'product_priorities:edit']) {
      denied = permission
      const before = calls.filter(call => call.path.includes('versions:')).length
      assert.ok([403, 404].includes((await request(path, item)).status))
      assert.equal(calls.filter(call => call.path.includes('versions:')).length, before)
    }
    denied = ''
    wrongScope = true
    assert.ok([403, 404].includes((await request(path, item)).status), 'unrelated product grant must not authorize')
    wrongScope = false
    calls.length = 0
    checks.length = 0
    const response = await request(path, item)
    assert.equal(response.status, 200)
    assert.equal(response.cache, 'no-store')
    assert.equal(response.body.data.scopeRevision, 2)
    assert.equal(calls.filter(call => call.path.endsWith('/product-authorization')).length, 1, 'secondary checks share current server facts')
    const command = calls.find(call => call.path.endsWith('versions:plan-item-create'))
    assert.equal(command.options.appCode, 'enterprise')
    assert.equal(command.options.scope, 'aims:product-versions:edit')
    assert.equal(command.options.idempotencyKey, 'client-command-1')
    assert.deepEqual(command.options.query, {})
    assert.equal(command.options.body.tenant, session.tenant)
    assert.equal(command.options.body.deployment, session.deployment)
    assert.equal(command.options.body.productCode, 'P-A')
    assert.equal(command.options.body.input.version_id, 12)
    assert.equal(command.options.body.input.estimate_person_days, '2.50')
    assert.deepEqual(checks.map(check => `${check.resourceCode}:${check.action}`), ['product_versions:edit', 'product_requests:view', 'product_requests:decide', 'product_priorities:edit'])
    for (const name of ['authorization', 'request_authorization', 'request_decision_authorization', 'planning_authorization']) assert.equal(command.options.body[name].facts.actor_uid, session.uid)
    const confirm = { expectedRevision: 3, expectedVersionRevision: 2, expectedPlanRevision: 1, expectedScopeRevision: 2 }
    denied = 'product_priorities:prioritize'
    assert.ok([403, 404].includes((await request('/products/P-A/versions/12/plan/confirm', confirm)).status))
    denied = ''
    assert.equal((await request('/products/P-A/versions/12/plan/confirm', confirm)).status, 200)
    const plan = { expectedRevision: 3, expectedVersionRevision: 2, expectedPlanRevision: 1, goal: 'Login', startsOn: '2099-01-01', plannedReleaseDate: '2099-01-31', availablePersonDays: '10', reservePersonDays: '1' }
    assert.equal((await request('/products/P-A/versions/12/plan', { ...plan, startsOn: '2099-02-30' })).status, 400)
    assert.equal((await request('/products/P-A/versions/12/plan', plan)).status, 200)
    assert.equal(calls.at(-1).options.body.input.starts_on, '2099-01-01')
    const beforeUnsupported = calls.filter(call => call.path.includes('versions:')).length
    assert.equal((await request('/products/P-A/versions/12/unsupported', {})).status, 503)
    assert.equal(calls.filter(call => call.path.includes('versions:')).length, beforeUnsupported)
    const version = { expectedRevision: 3, versionCode: 'v1', name: 'First', description: '', plannedReleaseDate: '', planningMode: 'simple', businessOwnerUid: 'person-a' }
    assert.equal((await request('/products/P-A/versions', { ...version, authorization: {} })).status, 400)
    assert.equal((await request('/products/P-A/versions', version)).status, 200)
    assert.equal(calls.at(-1).options.scope, 'aims:product-versions:create')
    for (const [path, runtimePath] of [['/products/P-A/versions?page=1&pageSize=2', 'versions:list'], ['/products/P-A/versions/12', 'versions:view'], ['/products/P-A/versions/12/plan', 'versions:plan'], ['/products/P-A/versions/12/plan/items?page=1', 'versions:plan-items']]) {
      const response = await fetch(base + path)
      assert.equal(response.status, 200)
      const call = calls.at(-1)
      assert.ok(call.path.endsWith(runtimePath))
      assert.equal(call.options.scope, 'aims:product-versions:read')
      assert.equal(call.options.idempotencyKey, undefined)
    }
    for (const suffix of ['', '?parentId=10&page=1&pageSize=10']) {
      const response = await fetch(base + '/products/P-A/components' + suffix)
      assert.equal(response.status, 200)
      assert.ok(calls.at(-1).path.endsWith('/components:list'))
      assert.equal(calls.at(-1).options.scope, 'aims:product-components:read')
      assert.equal(calls.at(-1).options.body.authorization.action, 'view')
      assert.equal(calls.at(-1).options.body.tenant, session.tenant)
    }
    assert.equal(calls.at(-1).options.body.input.parent_id, 10)
    for (const query of ['?parentId=-1', '?actor=forged', '?tenant=tenant-b']) {
      const before = calls.length
      assert.equal((await fetch(base + '/products/P-A/components' + query)).status, 400)
      assert.equal(calls.length, before)
    }
    denied = 'product_components:view'
    const beforeComponents = calls.filter(call => call.path.endsWith('/components:list')).length
    assert.ok([403, 404].includes((await fetch(base + '/products/P-A/components')).status))
    assert.equal(calls.filter(call => call.path.endsWith('/components:list')).length, beforeComponents)
    denied = ''
    const requestBizId = '00000000-0000-4000-8000-000000000001'
    const common = { expectedRevision: 3, expectedRequestRevision: 1 }
    for (const [action, permission, body] of [
      ['merge', 'decide', { ...common, targetBizId: '00000000-0000-4000-8000-000000000002', expectedTargetRevision: 1, reason: 'same problem', impactNote: '' }],
      ['edit', 'edit', { ...common, title: 'Updated', problemStatement: 'Problem', sourceType: 'internal', urgencyLevel: 'P2', reason: 'clarify' }],
      ['decide', 'decide', { ...common, status: 'evaluating', reason: 'triage', impactNote: '' }],
      ['source-create', 'edit', { ...common, note: 'Interview', evidenceDate: null, kind: 'fact', direction: 'supporting' }],
      ['source-delete', 'delete', { ...common, expectedSourceRevision: 1, reason: 'duplicate' }]
    ]) {
      const endpoint = `/products/P-A/requests/${requestBizId}/${action}/12`
      assert.equal((await request(endpoint, { ...body, source_app: 'altoc' })).status, 400, 'browser cannot assert verified source identity')
      denied = `product_requests:${permission}`
      const before = calls.filter(call => !call.path.endsWith('/product-authorization')).length
      assert.ok([403, 404].includes((await request(endpoint, body)).status))
      assert.equal(calls.filter(call => !call.path.endsWith('/product-authorization')).length, before)
      denied = ''
      assert.equal((await request(endpoint, body)).status, 200)
      assert.equal(calls.at(-1).options.scope, `aims:product-requests:${action}`)
      assert.equal(calls.at(-1).options.body.authorization.action, permission)
      assert.equal(calls.at(-1).options.body.input.biz_id, requestBizId)
      assert.equal(calls.at(-1).options.idempotencyKey, 'client-command-1')
    }
    assert.equal((await fetch(base + `/products/P-A/requests/${requestBizId}/sources?page=1&pageSize=2`)).status, 200)
    assert.equal(calls.at(-1).options.scope, 'aims:product-requests:read')
    assert.equal(calls.at(-1).options.body.input.page_size, 2)
    assert.equal(calls.at(-1).options.idempotencyKey, undefined)
    for (const [action, body, permission] of [
      ['create', { parentId: null, expectedRevision: 3, name: 'Module', description: '', sortOrder: 0 }, 'edit'],
      ['edit', { expectedRevision: 3, expectedComponentRevision: 1, name: 'Renamed', description: '', sortOrder: 0, reason: 'Clarify' }, 'edit'],
      ['move', { parentId: null, expectedRevision: 3, expectedComponentRevision: 1, reason: 'Organize' }, 'edit'],
      ['delete', { expectedRevision: 3, expectedComponentRevision: 1, reason: 'Remove' }, 'delete']
    ]) {
      const endpoint = `/products/P-A/components/7/${action}`
      assert.equal((await request(endpoint, { ...body, tenant: 'forged' })).status, 400)
      denied = `product_components:${permission}`
      assert.equal((await request(endpoint, body)).status, 403)
      denied = ''
      assert.equal((await request(endpoint, body)).status, 200)
      assert.equal(calls.at(-1).path, `/v1/enterprise/aims/components:${action}`)
      assert.equal(calls.at(-1).options.scope, `aims:product-components:${action}`)
      assert.equal(calls.at(-1).options.body.authorization.action, permission)
      assert.equal(calls.at(-1).options.body.productCode, 'P-A')
      assert.equal(calls.at(-1).options.idempotencyKey, 'client-command-1')
    }
    globalThis.__planningSession = { ...session, subjectType: 'service' }
    assert.equal((await request(path, item)).status, 401, 'a service subject is not a user session')
    globalThis.__planningSession = session
    globalThis.useRuntimeConfig = () => ({ public: { appCode: 'aims' } })
    assert.equal((await request(path, item)).status, 503, 'physical Host identity cannot be selected by request headers')
  } finally {
    if (server) await new Promise(resolveClose => server.close(resolveClose))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__planningSession
    delete globalThis.__planningTransport
    delete globalThis.__planningAuthorization
  }
})
