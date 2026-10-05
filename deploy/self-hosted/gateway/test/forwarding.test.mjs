import assert from 'node:assert/strict'
import test from 'node:test'
import { configFor, registryRecord, startGateway, startUpstream } from './fixtures.mjs'

const FORGED = {
  'x-hzy-gateway': 'tenant-gateway',
  'x-hzy-gateway-token': 'forged-token-value',
  'x-hzy-tenant': 'OTHER-TENANT',
  'x-hzy-deployment': 'managed-cloud-console',
  'x-hzy-environment': 'prod',
  'x-hzy-app-code': 'finance',
  'x-hzy-actor-uid': 'admin',
  'x-hzy-data-runtime-url': 'https://evil.example.test',
  'x-hzy-tenant-runtime-url': 'https://evil.example.test',
  'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:1',
  'x-hzy-scheduler': 'tenant-gateway',
  'x-hzy-service-routes': '{"console":{"origin":"https://evil.example.test"}}',
  'x-hzy-some-future-header': 'forged',
  'x-forwarded-host': 'evil.example.test',
  'x-forwarded-proto': 'http',
  'x-forwarded-prefix': '/evil-prefix',
  'x-real-ip': '203.0.113.66',
  forwarded: 'for=1.2.3.4;host=evil.example.test'
}

async function setup(t, names, options = {}) {
  const upstreams = []
  for (const name of names) upstreams.push(await startUpstream(name, options.respond?.[name]))
  const config = configFor(upstreams, options)
  const gateway = await startGateway(config, { record: options.record ? () => options.record(config) : undefined })
  t.after(async () => {
    await gateway.close()
    for (const upstream of upstreams) await upstream.close()
  })
  return { config, gateway, upstream: Object.fromEntries(upstreams.map(item => [item.name, item])) }
}

test('client x-hzy-* and forwarding headers are stripped; trusted context comes from config + registry', async (t) => {
  const { config, gateway, upstream } = await setup(t, ['console', 'workflow'])
  const response = await gateway.request('/workflow/api/v1/tasks?x=1', { headers: new Headers({ ...FORGED, cookie: 'sid=abc', accept: 'application/json' }) })
  assert.equal(response.status, 200)
  const call = upstream.workflow.calls.at(-1)
  assert.equal(call.url, '/workflow/api/v1/tasks?x=1')
  const h = call.headers
  assert.equal(h['x-hzy-gateway'], 'tenant-gateway')
  assert.equal(h['x-hzy-gateway-token'], config.secrets.gatewayInternalToken)
  assert.equal(h['x-hzy-tenant'], config.site.tenantCode)
  assert.equal(h['x-hzy-environment'], config.site.environment)
  assert.equal(h['x-hzy-app-code'], 'workflow')
  assert.equal(h['x-hzy-deployment'], config.apps.workflow.deploymentCode)
  assert.equal(h['x-hzy-data-runtime-url'], config.runtime.endpoint)
  assert.equal(h['x-forwarded-host'], config.site.publicHost)
  assert.equal(h['x-forwarded-proto'], 'https')
  assert.equal(h['x-forwarded-prefix'], '/workflow')
  assert.notEqual(h['x-real-ip'], '203.0.113.66')
  assert.equal(h.forwarded, undefined)
  assert.equal(h.cookie, 'sid=abc')
  for (const name of ['x-hzy-actor-uid', 'x-hzy-tenant-runtime-url', 'x-hzy-local-runtime-dial-url', 'x-hzy-scheduler', 'x-hzy-some-future-header']) {
    assert.equal(h[name], undefined, name)
  }
  const routes = JSON.parse(h['x-hzy-service-routes'])
  assert.equal(routes.workflow.origin, upstream.workflow.origin)
  assert.equal(JSON.stringify(routes).includes('evil'), false)
  // Loopback apps are asked not to compress, so bodies stream unchanged.
  assert.equal(h['accept-encoding'], 'identity')
  // Nothing forged reached Platform either.
  for (const call of gateway.platformCalls) assert.equal(call.headers.get('x-hzy-tenant'), null)
})

test('per-app origins: Console at root, business prefixes to their own loopback process', async (t) => {
  const { gateway, upstream } = await setup(t, ['console', 'workflow', 'aims'])
  await gateway.request('/api/v1/console/auth/me')
  await gateway.request('/workflow/api/health')
  await gateway.request('/aims/api/v1/projects')
  assert.equal(upstream.console.calls.at(-1).url, '/api/v1/console/auth/me')
  assert.equal(upstream.workflow.calls.at(-1).url, '/workflow/api/health')
  assert.equal(upstream.aims.calls.at(-1).url, '/aims/api/v1/projects')
  assert.equal(upstream.aims.calls.at(-1).headers['x-hzy-deployment'], 'T900001-sh-aims')
})

test('unknown Host is refused before the Worker, and unconfigured apps never leave the host', async (t) => {
  const { gateway, upstream } = await setup(t, ['console'])
  const wrongHost = await gateway.request('/', { headers: new Headers({ host: 'wiztek.huizhi.yun' }) })
  assert.equal(wrongHost.status, 421)
  const absolute = await gateway.request('//evil.example.test/x')
  assert.equal(absolute.status, 400)
  assert.equal(upstream.console.calls.length, 0)
  const finance = await gateway.request('/finance/api/v1/invoices')
  assert.equal(finance.status, 404)
  assert.equal(upstream.console.calls.length, 0)
  assert.equal(gateway.platformCalls.every(call => call.path.startsWith('/api/platform/internal/tenant-gateway/')), true)
})

test('egress refuses any destination outside the configured origins', async (t) => {
  const { gateway } = await setup(t, ['console'])
  await assert.rejects(gateway.egressFetch('https://console.huizhi.yun/oauth/token'), { name: 'EgressRefusedError' })
  await assert.rejects(gateway.egressFetch('http://127.0.0.1:9/'), { name: 'EgressRefusedError' })
  assert.equal((await gateway.egressFetch('https://disabled.invalid/x')).status, 404)
})

test('registry answer that does not match the configured site binding fails closed', async (t) => {
  const { gateway, upstream } = await setup(t, ['console', 'workflow'], {
    // e.g. the managed-cloud deployment or a shared tenant/environment row.
    record: config => registryRecord(config, {
      apps: { console: { deploymentCode: 'C-managed-cloud-console' }, workflow: { deploymentCode: 'T900001-sh-workflow' } }
    })
  })
  const response = await gateway.request('/workflow/api/health')
  assert.equal(response.status, 503)
  assert.equal(upstream.workflow.calls.length + upstream.console.calls.length, 0)
})

test('request bodies stream through; oversized bodies are rejected with 413', async (t) => {
  const { gateway, upstream } = await setup(t, ['console', 'workflow'], {
    overrides: { limits: { maxRequestBodyBytes: 4096 } }
  })
  const ok = await gateway.request('/workflow/api/echo', {
    method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body: JSON.stringify({ hello: 'world' })
  })
  assert.equal(ok.status, 200)
  assert.equal(upstream.workflow.calls.at(-1).body, '{"hello":"world"}')
  const declared = await gateway.request('/workflow/api/echo', { method: 'POST', body: 'x'.repeat(5000) })
  assert.equal(declared.status, 413)
  const before = upstream.workflow.calls.length
  const chunked = await gateway.request('/workflow/api/echo', {
    method: 'POST', headers: new Headers({ 'transfer-encoding': 'chunked' }), body: 'y'.repeat(9000)
  })
  assert.equal(chunked.status, 413)
  assert.equal(upstream.workflow.calls.slice(before).some(call => call.body.length > 4096), false)
})

test('responses: redirects are not followed, loopback Location is rewritten, cookies kept, diagnostics stripped', async (t) => {
  const { config, gateway, upstream } = await setup(t, ['console', 'workflow'], {
    respond: {
      workflow: (call, res) => {
        if (call.url.startsWith('/workflow/redirect')) {
          res.writeHead(302, { location: `http://${res.req.headers.host}/workflow/next`, 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] })
          return res.end()
        }
        res.writeHead(200, { 'content-type': 'text/plain', 'x-hzy-data-runtime-token': 'leak', 'x-hzy-debug': 'internal' })
        res.end('ok')
      }
    }
  })
  const redirect = await gateway.request('/workflow/redirect')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.location, `https://${config.site.publicHost}/workflow/next`)
  assert.deepEqual(redirect.headers['set-cookie'], ['a=1; Path=/', 'b=2; Path=/'])
  assert.equal(upstream.workflow.calls.filter(call => call.url === '/workflow/next').length, 0)
  const plain = await gateway.request('/workflow/plain')
  assert.equal(plain.body, 'ok')
  assert.equal(plain.headers['x-hzy-data-runtime-token'], undefined)
  assert.equal(plain.headers['x-hzy-debug'], undefined)
  assert.equal(plain.headers['x-hzy-gateway'], 'tenant-gateway')
})

test('scheduler wake paths and Nitro tasks are not reachable from the public ingress', async (t) => {
  const { gateway, upstream } = await setup(t, ['console', 'workflow'])
  for (const path of ['/api/internal/policy-bundle/sync', '/workflow/api/internal/integration-operations/drain', '/_nitro/tasks/x']) {
    assert.equal((await gateway.request(path, { method: 'POST', body: '{}' })).status, 404, path)
  }
  assert.equal(upstream.workflow.calls.length + upstream.console.calls.length, 0)
})

test('ingress and health listeners bind loopback only; health exposes counters without secrets', async (t) => {
  const { config, gateway } = await setup(t, ['console'])
  assert.equal(gateway.ingress.address().address, '127.0.0.1')
  assert.equal(gateway.health.address().address, '127.0.0.1')
  const { rawRequest } = await import('./fixtures.mjs')
  const health = await rawRequest(gateway.healthPort, '/healthz', { headers: new Headers({ host: '127.0.0.1' }) })
  assert.equal(health.status, 200)
  const body = JSON.parse(health.body)
  assert.equal(body.status, 'ok')
  assert.ok(body.scheduler['integration-drain'])
  assert.equal(health.body.includes(config.secrets.gatewayInternalToken), false)
  assert.equal(health.body.includes(config.secrets.platformRegistryToken), false)
  const rebinding = await rawRequest(gateway.healthPort, '/healthz', { headers: new Headers({ host: 'attacker.example.test' }) })
  assert.equal(rebinding.status, 404)
  // The public ingress does not serve the health endpoint.
  assert.notEqual((await gateway.request('/healthz')).body.includes('"scheduler"'), true)
})

test('Codocs editor shell bypasses the Enterprise pilot credential-free; other /codocs pages go to the Host', async (t) => {
  const { config, gateway, upstream } = await setup(t, ['console', 'enterprise', 'codocs'], { enterprise: { pilot: true } })
  const shell = await gateway.request('/codocs/embed/editor/Doc_123', {
    headers: new Headers({ cookie: 'sid=abc', authorization: 'Bearer user', accept: 'text/html', 'x-hzy-tenant': 'OTHER' })
  })
  assert.equal(shell.status, 200)
  assert.equal(shell.headers['cache-control'], 'no-store')
  const call = upstream.codocs.calls.at(-1)
  assert.equal(call.url, '/codocs/embed/editor/Doc_123')
  for (const name of ['cookie', 'authorization', 'x-hzy-gateway-token', 'x-hzy-tenant']) assert.equal(call.headers[name], undefined, name)
  const asset = await gateway.request('/codocs/_nuxt/entry.abc123.js')
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.equal((await gateway.request('/codocs/embed/editor/Doc_123', { method: 'POST', body: 'x' })).status, 405)
  const editorCalls = upstream.codocs.calls.length

  await gateway.request('/codocs/mydocs')
  assert.equal(upstream.codocs.calls.length, editorCalls)
  assert.equal(upstream.enterprise.calls.at(-1).url, '/codocs/mydocs')
  assert.equal(upstream.enterprise.calls.at(-1).headers['x-hzy-deployment'], config.apps.enterprise.deploymentCode)
})
