import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

test('navigation API validates session, isolates module snapshots and preserves outage semantics', async () => {
  let available = true
  let denied = false
  let outage = false
  const seen = []
  const prior = globalThis.__navigationTest
  globalThis.__navigationTest = {
    user: () => { if (denied) throw Object.assign(Error('Unauthorized'), { statusCode: 401 }); return { uid: 'u1', tenant: 't1', deployment: 'd1' } },
    available: () => available,
    load: (uid, module) => {
      seen.push([uid, module])
      if (outage) throw Object.assign(Error('Authorization unavailable'), { statusCode: 503 })
      return { resources: module === 'codocs' ? { documents: ['view'] } : {}, actionPolicies: {} }
    }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const mocks = {
      '@hzy/foundation/server/utils/enterpriseRuntimeClient': 'export const requireEnterpriseUser=async()=>globalThis.__navigationTest.user()',
      '@hzy/foundation/server/utils/tenantRuntimeClient': 'export const isTenantRuntimeEnabled=()=>globalThis.__navigationTest.available()',
      '@hzy/foundation/server/utils/platformBundleAuthorization': 'export const loadAuthorizationSnapshotFromConsoleRuntime=async(...args)=>globalThis.__navigationTest.load(...args)',
      // The opt-in verified-policy gate is disabled here; diagnostics are inert.
      '../../../utils/enterprisePolicyGate': 'export const requireCurrentEnterprisePolicy=async()=>{}',
      '@hzy/foundation/server/utils/authDependencyDiagnostic': 'export const logAuthDependencyFailure=()=>{}'
    }
    if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true }
    if (specifier.endsWith('/app/utils/enterprise-navigation')) return { url: new URL('../app/utils/enterprise-navigation.ts', import.meta.url).href, shortCircuit: true }
    if (specifier === '@hzy/foundation/shared/utils/authorizationActions') return { url: pathToFileURL(resolve(import.meta.dirname, '../../foundation/shared/utils/authorizationActions.ts')).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const handler = (await import('../server/routes/enterprise/api/navigation.get.ts')).default
    const app = createApp()
    app.use(createRouter().get('/enterprise/api/navigation', handler))
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = () => fetch(`http://127.0.0.1:${server.address().port}/enterprise/api/navigation`)
    const result = await request()
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
    const body = await result.json()
    assert.ok(body.visibleIds.length)
    assert.ok(body.visibleIds.every(id => id.startsWith('codocs.')))
    assert.deepEqual(new Set(seen.map(([uid, module]) => `${uid}/${module}`)), new Set(['u1/aims', 'u1/assets', 'u1/codocs']))
    assert.deepEqual(Object.keys(body), ['visibleIds', 'maxAgeMs'])
    assert.equal(body.maxAgeMs, 300_000)
    available = false
    assert.deepEqual(await (await request()).json(), { visibleIds: [], maxAgeMs: 300_000 })
    available = true
    outage = true
    assert.equal((await request()).status, 503)
    outage = false
    denied = true
    assert.equal((await request()).status, 401)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    hooks.deregister()
    if (prior === undefined) delete globalThis.__navigationTest
    else globalThis.__navigationTest = prior
  }
})
