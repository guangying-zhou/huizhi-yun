import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { readFileSync } from 'node:fs'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { resolveConsoleUserApiRoute, matchConsoleUserApiRoute } from '../../foundation/shared/utils/consoleUserApiRoutes.ts'
import { navigationLeaves, resolveNavigationAccess } from '../shared/navigation-access.mjs'
import { enterpriseNavigation } from '../app/utils/enterprise-navigation.ts'

const keys = ['version', 'status', 'healthy', 'available', 'lastSeenAt', 'checkedAt', 'failureCategory'].sort()
const paths = ['/enterprise/api/runtime-status/data', '/enterprise/api/runtime-status/applications']
test('C2 exact registry and Gateway/readiness expose GET only, never config/action/update', () => {
  for (const [index, id] of ['runtime-summary.data.read', 'runtime-summary.applications.read'].entries()) {
    const { route, path } = resolveConsoleUserApiRoute(id)
    assert.equal(route.method, 'GET')
    assert.equal(route.write, false)
    assert.deepEqual(route.query, [])
    assert.equal(resolveEnterprisePilotPath(paths[index]).kind, 'api')
    assert.equal(isBusinessApiReady('GET', paths[index]), true)
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      assert.equal(isBusinessApiReady(method, paths[index]), false)
      assert.equal(matchConsoleUserApiRoute(method, path), null)
    }
  }
  for (const path of ['/api/v1/console/data-runtime/update', '/api/v1/console/data-runtime/update-status', '/api/v1/console/runtime/apps/aims/config', '/api/v1/console/runtime/apps/aims/action']) for (const method of ['GET', 'POST']) assert.equal(matchConsoleUserApiRoute(method, path), null)
  for (const path of ['/enterprise/api/runtime-status/data/config', '/enterprise/api/runtime-status/applications/action', '/enterprise/api/runtime-status/other']) assert.equal(resolveEnterprisePilotPath(path).kind, 'unavailable')
  for (const [path, resource] of [['console/server/api/v1/console/data-runtime/status.get.ts', 'data_runtime'], ['console/server/api/v1/console/runtime/apps/index.get.ts', 'runtime_apps']]) {
    const handler = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    assert.ok(handler.includes(`requirePermission(event, '${resource}', 'view')`))
  }
  const component = readFileSync(new URL('../../foundation/app/components/RuntimeStatusSummaryPage.vue', import.meta.url), 'utf8')
  assert.match(component, /\/console\/data-runtime/)
  assert.match(component, /\/console\/admin\/runtime-apps/)
  assert.doesNotMatch(component, /method: '(POST|PATCH|PUT|DELETE)'|processName|packageUrl|\bport\b|lastError|diagnostics|ecosystem/)
})

test('C2 navigation uses the manifest permission for each read summary', async () => {
  const leaves = navigationLeaves(enterpriseNavigation.businessNavigation, []).filter(item => item.id === 'console.integration.data-runtime' || item.id === 'console.integration.runtime-apps')
  assert.equal(leaves.length, 2)
  for (const resource of ['data_runtime', 'runtime_apps']) {
    const ids = await resolveNavigationAccess(leaves, { available: true, authenticatedSelf: true, load: async () => ({ resource }), allows: (snapshot, permission) => snapshot.resource === permission.resource && permission.action === 'view' })
    assert.deepEqual(ids, [resource === 'data_runtime' ? 'console.integration.data-runtime' : 'console.integration.runtime-apps'])
  }
  assert.deepEqual(await resolveNavigationAccess(leaves, { available: true, authenticatedSelf: true, load: async () => ({}), allows: () => false }), [])
})

test('C2 whitelist drops secrets and arbitrary diagnostics; fixed statuses/errors and no-store', async () => {
  const state = { seen: [], status: 0, malformed: false }
  const leak = { path: '/SECRET', packageUrl: 'https://SECRET', port: 9999, processName: 'SECRET', ecosystem: 'SECRET', diagnostics: { token: 'SECRET' }, error: 'SECRET', lastError: 'SECRET', unknown: 'SECRET' }
  state.data = { ...leak, latest: { ...leak }, runtime: { ...leak, reachable: true, status: 'ok', version: '0.3.248-test.adr017.1', checkedAt: '2026-09-26T22:00:00Z', lastSeenAt: '2026-09-26T21:59:00Z' } }
  state.apps = { ...leak, context: { ...leak, enabled: true }, items: [{ ...leak, appCode: 'SECRET', enabledInStack: true, status: 'online' }, { ...leak, enabledInStack: false, status: 'stopped' }] }
  globalThis.__runtimeSummaryTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export async function fetchConsoleUserApi(event,id){const s=globalThis.__runtimeSummaryTest;s.seen.push(id);if(s.status)throw Object.assign(Error('SECRET raw upstream'),{statusCode:s.status});if(s.malformed)return {token:'SECRET'};return id==='runtime-summary.data.read'?s.data:s.apps}`)}` }
    if (specifier.endsWith('/utils/consoleRuntimeSummaryRead')) return { shortCircuit: true, url: new URL(specifier + '.ts', context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    for (const kind of ['data', 'applications']) router.get('/enterprise/api/runtime-status/' + kind, (await import('../server/routes/enterprise/api/runtime-status/' + kind + '.get.ts')).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
    for (const path of paths) {
      const response = await request(path)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const body = await response.json()
      assert.deepEqual(Object.keys(body.data).sort(), keys)
      assert.equal(body.data.healthy, true)
      assert.equal(body.data.status, 'healthy')
      assert.ok(!JSON.stringify(body).includes('SECRET'))
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        const count = state.seen.length
        assert.ok([404, 405].includes((await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method })).status))
        assert.equal(state.seen.length, count)
      }
      for (const query of ['?tenant=other', '?appCode=aims', '?include=secret', '?path=/SECRET', '?uid=other']) {
        const count = state.seen.length
        assert.equal((await request(path + query)).status, 400)
        assert.equal(state.seen.length, count)
      }
      for (const status of [401, 403, 404, 503, 500]) {
        state.status = status
        const failure = await request(path)
        assert.equal(failure.status, status === 500 ? 502 : status)
        assert.ok(!(await failure.text()).includes('SECRET'))
      }
      state.status = 0
      state.malformed = true
      const malformed = await request(path)
      assert.equal(malformed.status, 502)
      assert.ok(!(await malformed.text()).includes('SECRET'))
      state.malformed = false
    }
    state.data.runtime.version = 'SECRET https://internal/key'
    state.data.runtime.checkedAt = 'SECRET'
    state.data.runtime.lastSeenAt = 'SECRET'
    state.data.runtime.status = 'SECRET'
    let body = await (await request(paths[0])).json()
    assert.equal(body.data.version, null)
    assert.equal(body.data.lastSeenAt, null)
    assert.equal(body.data.status, 'unknown')
    assert.equal(body.data.failureCategory, 'runtime-unhealthy')
    assert.ok(!JSON.stringify(body).includes('SECRET'))
    state.data.runtime.reachable = false
    body = await (await request(paths[0])).json()
    assert.equal(body.data.status, 'unavailable')
    assert.equal(body.data.failureCategory, 'runtime-unavailable')
    state.apps.items[0].status = 'SECRET'
    body = await (await request(paths[1])).json()
    assert.equal(body.data.failureCategory, 'applications-degraded')
    state.apps.context.enabled = false
    body = await (await request(paths[1])).json()
    assert.equal(body.data.status, 'unavailable')
    assert.equal(body.data.failureCategory, 'applications-unavailable')
    assert.ok(!JSON.stringify(body).includes('SECRET'))
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__runtimeSummaryTest
  }
})
