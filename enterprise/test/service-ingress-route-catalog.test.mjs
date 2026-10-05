import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { validateConfig, buildWorkerEnv } from '../../deploy/self-hosted/gateway/config.mjs'
import { deriveBusinessApiSurface } from '../composition/business-api-surface.mjs'
import { workflowCallbackTarget } from '../../workflow/server/utils/callbackTarget.ts'
import { notificationDetailSourceAuthorizationTarget } from '../../console/server/utils/notificationDetailContract.ts'

// Expose the actual private catalog builder only in this test's module loader.
// Its APP_ROUTES/default basePath and all normalization remain production code.
const gatewayUrl = new URL('../../deploy/cloudflare/tenant-gateway/src/index.js', import.meta.url).href
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context)
  if (url === gatewayUrl) return { ...loaded, source: `${loaded.source}\nexport { buildTrustedServiceRouteCatalog };` }
  return loaded
} })
let buildTrustedServiceRouteCatalog, resolvePlatformRegistryTenant, tenantBindingMatchesExpected
try {
  ({ buildTrustedServiceRouteCatalog, resolvePlatformRegistryTenant, tenantBindingMatchesExpected } = await import(gatewayUrl))
} finally {
  hooks.deregister()
}

function serviceUrlResolver(trusted) {
  const source = readFileSync(new URL('../../foundation/server/utils/serviceAppUrl.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  runInNewContext(compiled, {
    exports, URL, process: { env: {} },
    useRuntimeConfig: () => ({ hzy: { deploymentProfile: 'managed-cloud-multitenant' } }),
    require: (name) => {
      if (name === 'h3') return { getHeader: (event, key) => event.headers[key] }
      if (name === './tenantGatewayTrust') return { resolveTrustedTenantGatewayContext: () => trusted ? {} : null }
      throw Error(`Unexpected dependency: ${name}`)
    }
  })
  return exports.resolveServiceAppBaseUrl
}

test('Gateway catalog basePath resolves callback and Console directTarget to registered Host POST routes', () => {
  const catalog = buildTrustedServiceRouteCatalog({ HZY_ENTERPRISE_ORIGIN: 'http://127.0.0.1:31002' }, {
    deploymentCode: 'C000001-enterprise', apps: { enterprise: { deploymentCode: 'C000001-enterprise' } }
  })
  assert.equal(JSON.parse(catalog).enterprise.basePath, '/enterprise/')
  for (const [env, apps] of [
    [{}, { enterprise: { deploymentCode: 'C000001-enterprise' } }],
    [{ HZY_ENTERPRISE_ORIGIN: 'http://127.0.0.1:31002' }, {}],
    [{ HZY_ENTERPRISE_ORIGIN: 'http://127.0.0.1:31002' }, { enterprise: {} }]
  ]) {
    const raw = buildTrustedServiceRouteCatalog(env, { deploymentCode: 'must-not-fallback', apps })
    assert.equal(JSON.parse(raw || '{}').enterprise, undefined)
  }
  const event = { headers: { 'x-hzy-service-routes': catalog }, context: {} }
  const resolve = serviceUrlResolver(true)
  const registered = new Set(deriveBusinessApiSurface().routes.filter(row => row.method === 'POST').map(row => row.route))
  const callback = workflowCallbackTarget('aims')
  const paths = ['/api/v1/service/workflow/callback', '/api/v1/service/work-item-completion/workflow-callback']
  const notificationSource = readFileSync(new URL('../../console/server/utils/notificationDetails.ts', import.meta.url), 'utf8')
  assert.match(notificationSource, /resolveServiceAppBaseUrl\(input\.event, target\.audience, \{ directTarget: true \}\)/)
  const notificationPaths = [...notificationSource.matchAll(/const AUTHORIZATION(?:_FINALIZE)?_PATH = '([^']+)'/g)].map(match => match[1])
  assert.equal(notificationPaths.length, 2)
  for (const [target, relativePaths] of [
    [callback, paths],
    [notificationDetailSourceAuthorizationTarget('aims'), notificationPaths],
    [notificationDetailSourceAuthorizationTarget('assets'), [notificationPaths[0]]]
  ]) {
    const base = resolve(event, target.audience, { directTarget: true })
    assert.equal(base, 'http://127.0.0.1:31002/enterprise')
    for (const path of relativePaths) {
      const url = new URL(`${base}${path}`)
      assert.ok(registered.has(url.pathname), `Unregistered Host route: POST ${url.pathname}`)
      assert.equal(registered.has(path), false, `Root service route must not remain: ${path}`)
    }
  }
  assert.equal(serviceUrlResolver(false)(event, 'enterprise', { directTarget: true }), '')
})

test('production-shaped self-hosted config → Platform resolve → catalog → Host ingress routes', async () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/self-hosted-service-ingress-gateway.json', import.meta.url), 'utf8'))
  const config = validateConfig(raw)
  const env = buildWorkerEnv(config, { createBinding: origin => ({ origin }), disabledBinding: {} })
  assert.equal(env.HZY_ENTERPRISE_ORIGIN, raw.apps.enterprise.origin)
  // Platform resolves active deployment rows into apps[app_code]; local config
  // pins their identities but does not manufacture missing registry entries.
  const registry = {
    tenantCode: 'C000001', environment: 'prod', deploymentCode: 'C000001-prod-console',
    apps: {
      console: { deploymentCode: 'C000001-prod-console', basePath: '/console/' },
      enterprise: { deploymentCode: 'C000001-prod-enterprise', basePath: '/enterprise/' }
    },
    dataRuntime: { endpoint: config.runtime.endpoint, runtimeCode: config.runtime.runtimeCode }
  }
  const tenant = await resolvePlatformRegistryTenant(config.site.publicHost, env, async (url, init) => {
    assert.equal(new URL(url).pathname, '/api/platform/internal/tenant-gateway/resolve')
    assert.equal(new URL(url).searchParams.get('host'), config.site.publicHost)
    assert.equal(init.headers.get('authorization'), `Bearer ${raw.secrets.platformRegistryToken}`)
    return Response.json({ data: registry })
  })
  assert.equal(tenant.apps.enterprise.deploymentCode, raw.apps.enterprise.deploymentCode)
  assert.equal(tenantBindingMatchesExpected(tenant, config.site.publicHost, env), true)
  for (const enterprise of [undefined, { deploymentCode: 'wrong-deployment' }]) {
    const apps = { ...tenant.apps, enterprise }
    assert.equal(tenantBindingMatchesExpected({ ...tenant, apps }, config.site.publicHost, env), false)
  }
  const catalog = buildTrustedServiceRouteCatalog(env, tenant)
  assert.deepEqual(JSON.parse(catalog).enterprise, {
    origin: 'http://127.0.0.1:31002', deploymentCode: 'C000001-prod-enterprise', basePath: '/enterprise/'
  })
  const event = { headers: { 'x-hzy-service-routes': catalog }, context: {} }
  const resolve = serviceUrlResolver(true)
  const routes = new Set(deriveBusinessApiSurface().routes.filter(row => row.method === 'POST').map(row => row.route))
  for (const [target, path] of [
    [workflowCallbackTarget('aims'), '/api/v1/service/workflow/callback'],
    [workflowCallbackTarget('aims'), '/api/v1/service/work-item-completion/workflow-callback'],
    [notificationDetailSourceAuthorizationTarget('aims'), '/api/v1/service/notification-details/authorize'],
    [notificationDetailSourceAuthorizationTarget('aims'), '/api/v1/service/notification-details/authorize/finalize']
  ]) {
    const url = new URL(`${resolve(event, target.audience, { directTarget: true })}${path}`)
    assert.equal(url.origin, raw.apps.enterprise.origin)
    assert.ok(routes.has(url.pathname), `Unregistered Host route: ${url.pathname}`)
  }
})
