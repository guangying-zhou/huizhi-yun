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
test('real H3 version history retains validation, scope and immutable response projection', async () => {
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
    const { enterpriseProductPlanningBridge:bridge }=await import('../server/utils/enterpriseProductPlanning.ts')
    const { handleProductVersionAcceptance:acceptance }=await import('../../aims/server/utils/productVersionAcceptanceRuntime.ts')
    const { handleProductVersionCollection:release }=await import('../../aims/server/utils/productVersionRuntime.ts')
    const app=createApp(),router=createRouter();app.use(defineEventHandler(e=>{e.context.consoleAuth=session}))
    router.get('/products/:productCode/versions/:versionId/acceptances',defineEventHandler(async e=>acceptance(e,'list',await bridge(e))))
    router.get('/products/:productCode/versions/:versionId/acceptances/:acceptanceId',defineEventHandler(async e=>acceptance(e,'view',await bridge(e))))
    router.get('/products/:productCode/versions/:versionId/releases',defineEventHandler(async e=>release(e,'release-list',await bridge(e))))
    router.get('/products/:productCode/versions/:versionId/releases/:recordId',defineEventHandler(async e=>release(e,'release-view',await bridge(e))))
    app.use(router);server=createServer(toNodeListener(app));await new Promise(r=>server.listen(0,'127.0.0.1',r))
    const base=`http://127.0.0.1:${server.address().port}/products/P-A/versions/1/`
    for(const path of ['acceptances?page=0','acceptances?tenant=other','acceptances/0','releases?pageSize=1000','releases/abc']){
      const before=calls.length;assert.equal((await fetch(base+path)).status,400);assert.equal(calls.length,before)
    }
    denied='product_versions:view';assert.ok([403,404].includes((await fetch(base+'releases')).status));denied=''
    wrongScope=true;assert.ok([403,404].includes((await fetch(base+'acceptances/1')).status));wrongScope=false
    for(const [path,op] of [['acceptances','acceptance-list'],['acceptances/7','acceptance-view'],['releases','release-list'],['releases/9','release-view']]){
      calls.length=0;const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
      const sent=calls.find(c=>c.path.endsWith('product-version:'+op));assert.ok(sent,op)
      assert.equal(sent.options.scope,'aims:product-versions:read');assert.equal(sent.options.appCode,'enterprise');assert.equal(sent.options.idempotencyKey,undefined)
      assert.equal(sent.options.body.authorization.action,'view');assert.equal(sent.options.body.authorization.facts.actor_uid,'person-a')
      assert.equal(sent.options.body.tenant,'tenant-a');assert.equal(sent.options.body.deployment,'enterprise-test')
      assert.equal(sent.options.body.input.version_id,1)
    }
  }finally{
    if(server)await new Promise(r=>server.close(r));hooks.deregister();globalThis.useRuntimeConfig=oldConfig
    delete globalThis.__planningSession;delete globalThis.__planningTransport;delete globalThis.__planningAuthorization
  }
})
