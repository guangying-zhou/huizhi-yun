import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createApp, createRouter, defineEventHandler, toWebHandler, send, setResponseStatus } from 'h3'
import { deriveBusinessApiSurface } from '../composition/business-api-surface.mjs'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'

const isAPF = route => /^\/(?:altoc\/api|finance\/api|people\/api|enterprise\/api\/apf\/(?:people|altoc|finance))\//.test(route)

test('APF dynamic siblings use one parameter name so Nitro cannot shadow registered handlers', () => {
  const names = new Map()
  for (const { route } of deriveBusinessApiSurface().routes.filter(row => isAPF(row.route))) {
    const parts = route.split('/')
    for (let index = 0; index < parts.length; index++) {
      if (!parts[index].startsWith(':')) continue
      const prefix = parts.slice(0, index).map(part => part.startsWith(':') ? ':' : part).join('/')
      if (names.has(prefix)) assert.equal(parts[index], names.get(prefix), route)
      names.set(prefix, parts[index])
    }
  }
})

test('every Altoc/Finance/People write matches the actual Nitro H3 router and JSON instead of SPA', async () => {
  // Resolve exactly the H3 installed under Nitro, not a hand-written matcher.
  const require = createRequire(import.meta.url)
  assert.ok(require.resolve('h3'))
  const { routes } = deriveBusinessApiSurface()
  const app = createApp({ onError: (_error, event) => {
    setResponseStatus(event, 200)
    return send(event, '<html>SPA fallback</html>', 'text/html')
  } })
  const router = createRouter({ preemptive: true })
  for (const { method, route } of routes) router.use(route, defineEventHandler(() => ({ route, method })), method === 'ALL' ? undefined : method.toLowerCase())
  app.use(router.handler)
  const fetch = toWebHandler(app)
  const writes = routes.filter(row => isAPF(row.route) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(row.method))
  assert.ok(writes.length > 100)
  for (const { method, route } of writes) {
    const path = route.replace(/:[\w]+/g, '1')
    const gateway = resolveEnterprisePilotPath(path, '', method)
    assert.equal(gateway?.kind, 'api', method + ' ' + route)
    assert.equal(gateway.path, path)
    const response = await fetch(new Request('http://fixture' + path, { method }))
    assert.match(response.headers.get('content-type') || '', /^application\/json/, method + ' ' + route)
    assert.deepEqual(await response.json(), { route, method }, method + ' ' + route)
  }
})
