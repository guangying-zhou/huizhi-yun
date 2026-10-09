import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'
import { deriveBusinessApiSurface } from '../composition/business-api-surface.mjs'
import { businessModules, hostNativePages, navigationContributors, registerBusinessPages } from '../composition/registry.mjs'
import { annotateHostNativePageAuthorization } from '../composition/host-native-pages.mjs'

const localTs = new Map([
  ['/utils/hostAuthorizationApps', '../server/utils/hostAuthorizationApps.ts'],
  ['/utils/enterpriseApiNotFound', '../server/utils/enterpriseApiNotFound.ts'],
  ['/app/utils/enterprise-navigation', '../app/utils/enterprise-navigation.ts']
])

function hooksWith(mocks) {
  return registerHooks({ resolve(specifier, context, next) {
    if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true }
    for (const [suffix, file] of localTs) {
      if (specifier.endsWith(suffix)) return { url: new URL(file, import.meta.url).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
}

async function serve(app) {
  const server = createServer(toNodeListener(app))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: path => `http://127.0.0.1:${server.address().port}${path}`,
    async close() {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}

test('the snapshot module allowlist is the composition registry, not a hand-written list', async () => {
  const hooks = hooksWith({})
  try {
    const { hostAuthorizationApps } = await import('../server/utils/hostAuthorizationApps.ts')
    assert.deepEqual([...hostAuthorizationApps].sort(), navigationContributors.map(module => module.code).sort())
    for (const code of ['aims', 'assets', 'codocs', 'altoc', 'console', 'finance']) assert.ok(hostAuthorizationApps.includes(code))
  } finally {
    hooks.deregister()
  }
})

test('every composed page carries its owning module for the browser snapshot', () => {
  const registered = registerBusinessPages([], businessModules, '/placeholder.vue')
  const walk = (pages, module) => {
    for (const page of pages) {
      assert.equal(page.meta?.authorizationApp ?? module, module, `${page.name} must belong to ${module}`)
      if (page.children) walk(page.children, module)
    }
  }
  for (const page of registered) {
    assert.equal(page.meta.authorizationApp, page.meta.logicalModule)
    walk(page.children || [], page.meta.authorizationApp)
  }
  assert.ok(registered.some(page => page.path === '/aims/timesheet' && page.meta.authorizationApp === 'aims'))

  // Host-native pages are annotated from the validated projection only.
  const pages = [...hostNativePages.map(page => ({ path: page.path, file: page.file })), { path: '/enterprise/approvals', file: '/x/approvals.vue' }]
  annotateHostNativePageAuthorization(pages, hostNativePages)
  for (const native of hostNativePages) {
    assert.equal(pages.find(page => page.path === native.path).meta.authorizationApp, native.module)
  }
  assert.equal(pages.at(-1).meta, undefined, 'a Host page without an owning module gets no module snapshot')
  assert.ok(hostNativePages.some(page => page.module === 'console'))
  assert.ok(hostNativePages.some(page => page.module === 'altoc'))
})

test('permissions endpoint: verified session, strict allowlist, normal merged snapshot, 503 on dependency failure', async () => {
  const state = { denied: false, policyFailure: false, failure: null, snapshot: null, calls: [] }
  const prior = globalThis.__hostPermissionsTest
  globalThis.__hostPermissionsTest = {
    user: () => {
      if (state.denied) throw Object.assign(Error('Unauthorized'), { statusCode: 401 })
      return { uid: 'u1', tenant: 't1', deployment: 'd1' }
    },
    policy: () => {
      if (state.policyFailure) throw Object.assign(Error('Policy unavailable'), { statusCode: 503 })
    },
    load: (uid, app, _event, options) => {
      state.calls.push([uid, app, options])
      if (state.failure) throw state.failure
      if (state.snapshot !== null) return state.snapshot
      return {
        uid, roles: ['project_manager'], availableRoles: [{ roleCode: 'project_manager' }], activeRoleCode: 'project_manager',
        resources: app === 'aims' ? { timesheet: ['view', 'submit'], weekly_reports: ['review'] } : { products: ['view'] },
        actionPolicies: {}
      }
    }
  }
  const hooks = hooksWith({
    '@hzy/foundation/server/utils/enterpriseRuntimeClient': 'export const requireEnterpriseUser=async()=>globalThis.__hostPermissionsTest.user()',
    '@hzy/foundation/server/utils/platformBundleAuthorization': 'export const loadAuthorizationSnapshotFromConsoleRuntime=async(...args)=>globalThis.__hostPermissionsTest.load(...args)',
    '@hzy/foundation/server/utils/authDependencyDiagnostic': 'export const logAuthDependencyFailure=()=>{}',
    '../../../../utils/enterprisePolicyGate': 'export const requireCurrentEnterprisePolicy=async()=>globalThis.__hostPermissionsTest.policy()'
  })
  let server
  try {
    const handler = (await import('../server/routes/enterprise/api/auth/permissions.get.ts')).default
    const app = createApp()
    app.use(createRouter().get('/enterprise/api/auth/permissions', handler))
    server = await serve(app)
    const get = query => fetch(server.url(`/enterprise/api/auth/permissions${query}`))

    const ok = await get('?app=aims')
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'private, no-store')
    assert.match(ok.headers.get('content-type'), /application\/json/)
    assert.deepEqual(await ok.json(), {
      code: 0,
      data: {
        appCode: 'aims', uid: 'u1', roles: ['project_manager'], availableRoles: [], activeRoleCode: '',
        resources: { timesheet: ['view', 'submit'], weekly_reports: ['review'] }, actionPolicies: {}
      }
    })
    // Normal merged mode: the Host passes no role selection, local-dev or admin expansion options.
    assert.deepEqual(state.calls, [['u1', 'aims', undefined]])

    const assets = await (await get('?app=assets')).json()
    assert.equal(assets.data.appCode, 'assets')
    assert.deepEqual(assets.data.resources, { products: ['view'] })
    for (const code of ['codocs', 'console', 'altoc', 'finance', 'people']) assert.equal((await get(`?app=${code}`)).status, 200)

    state.calls.length = 0
    for (const query of ['', '?app=not-installed', '?app=AIMS', '?app=aims&app=assets', '?app=aims&role=system_admin', '?app=enterprise', '?module=aims']) {
      const response = await get(query)
      assert.equal(response.status, 400, `${query} must be rejected`)
      assert.match(response.headers.get('content-type'), /application\/json/)
    }
    assert.equal(state.calls.length, 0, 'a rejected module never reaches Console')

    state.denied = true
    assert.equal((await get('?app=aims')).status, 401)
    assert.equal((await get('?app=people')).status, 401, 'session is verified before the module is examined')
    state.denied = false

    state.policyFailure = true
    assert.equal((await get('?app=aims')).status, 503)
    assert.equal(state.calls.length, 0)
    state.policyFailure = false

    for (const failure of [
      Object.assign(Error('Console authorization unavailable'), { statusCode: 503 }),
      Object.assign(Error('fetch failed'), { name: 'FetchError' }),
      Object.assign(Error('Bad gateway'), { statusCode: 502 })
    ]) {
      state.failure = failure
      const response = await get('?app=aims')
      assert.equal(response.status, 503, 'a Console dependency failure is never an empty 200')
      assert.equal((await response.json()).data?.code, 'enterprise_authorization_unavailable')
    }
    state.failure = Object.assign(Error('Forbidden'), { statusCode: 403 })
    assert.equal((await get('?app=aims')).status, 403)
    state.failure = null

    for (const snapshot of [undefined, { resources: null }, { resources: [] }]) {
      state.snapshot = snapshot
      assert.equal((await get('?app=aims')).status, 503)
    }
    state.snapshot = null
  } finally {
    if (server) await server.close()
    hooks.deregister()
    if (prior === undefined) delete globalThis.__hostPermissionsTest
    else globalThis.__hostPermissionsTest = prior
  }
})

test('unregistered Host API paths answer JSON 404, never the SPA fallback', async () => {
  const hooks = hooksWith({})
  let server
  try {
    const readiness = (await import('../server/middleware/01-business-api.ts')).default
    const notFound = (await import('../server/routes/api/[...].ts')).default
    const app = createApp()
    app.use(readiness)
    const router = createRouter()
      .get('/enterprise/api/navigation', defineEventHandler(() => ({ visibleIds: [] })))
      .get('/api/auth/me', defineEventHandler(() => ({ authenticated: false })))
      .use('/api/**', notFound)
    app.use(router)
    // Stand-in for the Nuxt renderer: any path that falls through gets HTML.
    app.use(defineEventHandler(() => '<!DOCTYPE html><html></html>'))
    server = await serve(app)

    for (const path of ['/enterprise/api/auth/unknown', '/enterprise/api/internal/probe', '/enterprise/api', '/api/auth/permissions', '/api/auth/unknown', '/api/anything/else']) {
      const response = await fetch(server.url(path), { headers: { accept: 'text/html' } })
      assert.equal(response.status, 404, path)
      assert.match(response.headers.get('content-type'), /application\/json/, path)
      assert.deepEqual((await response.json()).data, { code: 'enterprise_api_not_found' }, path)
    }
    assert.equal((await fetch(server.url('/enterprise/api/navigation'))).status, 200)
    assert.deepEqual(await (await fetch(server.url('/api/auth/me'))).json(), { authenticated: false })
    // Business module prefixes keep their migration semantics.
    const module = await fetch(server.url('/aims/api/v1/not-migrated'), { headers: { accept: 'application/json' } })
    assert.equal(module.status, 503)
    assert.equal((await module.json()).data?.code, 'enterprise_module_runtime_not_ready')
  } finally {
    if (server) await server.close()
    hooks.deregister()
  }
})

test('the 404 fallback never widens the readiness boundary and the endpoint is routed to the Host', () => {
  const surface = deriveBusinessApiSurface()
  assert.ok(!surface.routes.some(route => route.file === 'api/[...].ts'))
  assert.equal(isBusinessApiReady('GET', '/api/workflow-proxy/tasks/123/delegate'), false)
  assert.equal(isBusinessApiReady('GET', '/enterprise/api/auth/permissions'), true)
  assert.equal(isBusinessApiReady('POST', '/enterprise/api/auth/permissions'), false)

  // The gateway keeps /enterprise on this path (no auth-prefix rewrite) so it
  // reaches the Host route instead of an unregistered root /api/auth/* path.
  assert.deepEqual(resolveEnterprisePilotPath('/enterprise/api/auth/permissions', '?app=aims', 'GET'), { path: '/enterprise/api/auth/permissions', kind: 'api' })
  assert.equal(resolveEnterprisePilotPath('/enterprise/api/auth/permissions', '', 'POST').kind, 'unavailable')
  assert.deepEqual(resolveEnterprisePilotPath('/enterprise/api/auth/oidc-callback', '', 'GET'), { path: '/api/auth/oidc-callback', kind: 'auth' })
})
