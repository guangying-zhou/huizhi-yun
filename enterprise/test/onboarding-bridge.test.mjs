import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('real H3 onboarding reuses validators, global permission, directory checks and fixed Host identity', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = []
  let globalGrant = true, active = true
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__onboardSession = session
  globalThis.__onboardAuth = async (_event, _uid, app, required) => ({ grants: [{ grantId: 'explicit', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: globalGrant || app === 'assets' ? 'tenant' : 'product', predicate: globalGrant || app === 'assets' ? 'global' : 'code', value: 'P-A' }] }] })
  globalThis.__onboardDirectory = async (_event, uids) => uids.map(uid => ({ uid, active }))
  const item = { product_code: 'P-A', product_name: 'Current Assets', product_line: 'L-A', product_line_label: 'Line', onboardable: true }
  const watermark = 'current-assets:v1:' + 'a'.repeat(64)
  globalThis.__onboardRuntime = async (_event, path, options) => {
    calls.push({ path, options })
    const data = path.endsWith('product-onboard:candidates') ? { items: [item], total: 1, page: 1, pageSize: 100, nextPage: null, watermark: 'current-assets-page:v1:' + 'b'.repeat(64) }
      : path.endsWith('product-line-onboard:candidates') ? { line_code: 'L-A', label: 'Line', items: [item], total: 1, watermark }
        : { receipt_id: 'receipt', product_code: options.body.productCode }
    return { handled: true, data: { code: 0, data } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge = async () => globalThis.__onboardSession'
    if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime = (...args) => globalThis.__onboardRuntime(...args); export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime = async () => true'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime = (...args) => globalThis.__onboardAuth(...args)'
    if (specifier.endsWith('/directoryApi')) source = 'export const fetchDirectoryActiveStatuses = (...args) => globalThis.__onboardDirectory(...args)'
    if (specifier === '@hzy/foundation/server/utils/authIdentity') source = 'export const requireFoundationSessionUid = async () => globalThis.__onboardSession.uid'
    // The standalone cross-application catalog is an unused remote dependency.
    if (specifier === './productCatalog') source = 'export const fetchProductCatalog = async () => { throw Error("standalone catalog must not run in Host") }'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseProductOnboard, enterpriseProductCandidates } = await import('../server/utils/enterpriseProductOnboarding.ts')
    const { productLineOnboardInput } = await import('../../aims/server/utils/productLineInput.ts')
    const app = createApp(), router = createRouter()
    const { default: permissions } = await import('../server/routes/aims/api/v1/product-permissions.get.ts')
    router.get('/product-permissions', permissions)
    router.post('/products', defineEventHandler(enterpriseProductOnboard))
    router.get('/product-candidates', defineEventHandler(enterpriseProductCandidates))
    app.use(router)
    server = createServer(toNodeListener(app));await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, body) => {
      const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'onboard-1', 'x-hzy-tenant': 'forged' }, body: JSON.stringify(body) } : undefined)
      return { status: response.status, body: await response.json() }
    }
    const draft = { productCode: 'P-A', managerUid: 'manager-a', reason: 'Start product planning' }
    assert.equal((await request('/products', { ...draft, tenant: 'forged' })).status, 400)
    assert.equal(calls.length, 0)
    globalGrant = false
    assert.deepEqual((await request('/product-permissions')).body, { code: 0, data: { onboard: false } })
    assert.equal((await request('/products', draft)).status, 403)
    assert.equal(calls.length, 0)
    globalGrant = true;active = false
    assert.deepEqual((await request('/product-permissions')).body, { code: 0, data: { onboard: true } })
    assert.equal((await request('/products', draft)).status, 400)
    assert.ok(calls.every(c => c.path.endsWith(':candidates')))
    active = true;calls.length = 0
    assert.equal((await request('/products', draft)).status, 200)
    const command = calls.at(-1)
    assert.equal(command.path, '/v1/enterprise/aims/product-onboard')
    assert.equal(command.options.appCode, 'enterprise')
    assert.equal(command.options.scope, 'aims:products:onboard')
    assert.equal(command.options.idempotencyKey, 'onboard-1')
    assert.equal(command.options.body.tenant, 'tenant-a')
    assert.equal(command.options.body.authorization.actor_uid, 'person-a')
    assert.deepEqual(command.options.body.directory.active_uids, ['manager-a'])
    assert.equal('source' in command.options.body, false)
    assert.equal((await request('/product-candidates?mode=line&productLine=L-A')).status, 200)
    const line = { productLine: 'L-A', managerUid: 'manager-a', productCodes: ['P-A'], expectedWatermark: watermark }
    assert.equal(productLineOnboardInput(line), null, 'standalone watermark contract stays unchanged')
    assert.equal((await request('/products', line)).status, 200)
    assert.equal(calls.at(-1).path, '/v1/enterprise/aims/product-line-onboard')
    assert.equal(calls.at(-1).options.body.lineCode, 'L-A')
    assert.equal(calls.at(-1).options.body.input.expected_watermark, watermark)
    assert.equal((await request('/products', { ...line, expectedWatermark: 'current-assets:v1:' + 'c'.repeat(64) })).status, 409)
    assert.equal((await request('/product-candidates?page=2')).status, 400)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister();globalThis.useRuntimeConfig = oldConfig
    for (const key of ['__onboardSession', '__onboardAuth', '__onboardDirectory', '__onboardRuntime']) delete globalThis[key]
  }
})
