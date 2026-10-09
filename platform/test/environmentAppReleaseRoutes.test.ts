import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative, join } from 'node:path'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routeFiles(join(root, entry.name)) : [join(root, entry.name)])
}

test('real H3 router resolves pin preview/save and every ops tenant route with shared dynamic nodes', async (t) => {
  const root = fileURLToPath(new URL('../server/api/', import.meta.url))
  const router = createRouter()
  const routes = routeFiles(root).filter(path => path.endsWith('.ts')).map((path) => {
    let name = relative(root, path).replaceAll('\\', '/').replace(/\.ts$/, '')
    const methodMatch = name.match(/\.(get|post|put|patch|delete|head|options)$/)
    const method = methodMatch?.[1] || 'all'
    name = name.replace(/\.(get|post|put|patch|delete|head|options)$/, '').replace(/\/index$/, '')
    const route = '/api/' + name.replace(/\[\.\.\.([^\]]*)\]/g, '**').replace(/\[([^\]]+)\]/g, ':$1')
    return { route, method }
  }).sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))
  for (const row of routes) router.use(row.route, () => row, row.method)
  const server = createServer(toNodeListener(createApp().use(router.handler)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const target = routes.filter(row => row.route.startsWith('/api/platform/ops/tenants/'))
  assert.ok(target.some(row => row.route.endsWith('/app-releases/preview') && row.method === 'post'))
  assert.ok(target.some(row => row.route.endsWith('/app-releases') && row.method === 'put'))
  for (const row of target) {
    const path = row.route.replace(':tenantCode', 'C000001')
    const response = await fetch(base + path, { method: row.method.toUpperCase() })
    assert.equal(response.status, 200, `${row.method} ${path}`)
    assert.deepEqual(await response.json(), row, `${row.method} ${path} must not hit API fallback`)
  }
})
