import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createLocalEnterpriseGateway } from '../gateway-transport.mjs'

function profile(port) {
  return { environment: 'test', runtime: { canonicalEndpoint: 'https://hzy-test-runtime.isme.dev', transportMode: 'public-https', dialEndpoint: null, automaticFallback: false, expectedTenant: 'C000001', expectedRuntimeCode: 'runtime-test' }, identity: { consoleDeployment: 'console-test', enterpriseDeployment: 'enterprise-test' }, listeners: { enterprise: { host: '127.0.0.1', port }, codocsEditor: { host: '127.0.0.1', port: 23130 }, aims: { host: '127.0.0.1', port: 23141 }, workflow: { host: '127.0.0.1', port: 23140 } } }
}

test('local Workflow opens only exact Host BFF methods and no public Workflow service', async () => {
  const upstream = createServer((req, res) => {
    const routes = JSON.parse(req.headers['x-hzy-service-routes'] || '{}')
    assert.deepEqual(routes.aims, { origin: 'http://127.0.0.1:23141', deploymentCode: 'C000001-test-aims', basePath: '/aims/' })
    assert.deepEqual(routes.workflow, { origin: 'http://127.0.0.1:23140', deploymentCode: 'C000001-test-workflow-local', basePath: '/workflow/' })
    res.writeHead(200); res.end(req.url)
  })
  const port = await listen(upstream)
  const gateway = createLocalEnterpriseGateway({ ...profile(port), features: { workflowLocal: true } }, 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    for (const [method, path] of [
      ['GET', '/api/workflow-proxy/instances/by-biz'],
      ['GET', '/api/workflow-proxy/instances/by-biz-history'],
      ['GET', '/api/workflow-proxy/instances/12'],
      ['GET', '/api/workflow-proxy/tasks/12'],
      ['GET', '/api/workflow-proxy/tasks/pending'],
      ['GET', '/enterprise/approvals'],
      ['GET', '/enterprise/approvals/12'],
      ['POST', '/api/workflow-proxy/tasks/12/approve'],
      ['POST', '/api/workflow-proxy/tasks/12/reject']
    ]) assert.equal((await request(gatewayPort, path, { host: 'hzy0.isme.dev' }, method)).statusCode, 200, `${method} ${path}`)
    for (const [method, path] of [['GET', '/workflow/api/v1/tasks/pending'], ['GET', '/api/workflow-proxy/tasks/done'], ['POST', '/api/workflow-proxy/tasks/12/delegate'], ['POST', '/api/workflow-proxy/instances'], ['POST', '/api/workflow-proxy/instances/prepare'], ['DELETE', '/api/workflow-proxy/instances/12'], ['GET', '/enterprise/approvals/0'], ['POST', '/enterprise/approvals/12']]) {
      assert.equal((await request(gatewayPort, path, { host: 'hzy0.isme.dev' }, method)).statusCode, 404, `${method} ${path}`)
    }
  } finally { await close(gateway); await close(upstream) }
})
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }); return server.address().port }
async function close(server) { await new Promise(resolve => server.close(resolve)) }

test('Dev modules bypass conditional caches without changing preview caching', async () => {
  let received
  const upstream = createServer((req, res) => {
    received = req.headers
    res.writeHead(200, { 'cache-control': 'max-age=31536000, immutable', etag: 'old-module', 'last-modified': 'Sun, 20 Sep 2026 00:00:00 GMT' })
    res.end('export const current = true')
  })
  const port = await listen(upstream)
  try {
    for (const mode of ['dev', 'preview']) {
      const gateway = createLocalEnterpriseGateway({ ...profile(port), mode }, 'fixture-secret')
      const gatewayPort = await listen(gateway)
      try {
        const response = await request(gatewayPort, '/enterprise/_nuxt/module.js?v=old', { host: 'hzy0.isme.dev', 'if-none-match': 'old-module', 'if-modified-since': 'old-date' })
        assert.equal(response.headers['cache-control'], mode === 'dev' ? 'no-store' : 'max-age=31536000, immutable')
        assert.equal(response.headers.etag, mode === 'dev' ? undefined : 'old-module')
        assert.equal(received['if-none-match'], mode === 'dev' ? undefined : 'old-module')
        assert.equal(received['if-modified-since'], mode === 'dev' ? undefined : 'old-date')
      } finally { await close(gateway) }
    }
  } finally { await close(upstream) }
})

test('only immutable versioned optimizer JS is browser-cacheable; CDN and mutable sources stay no-store', async () => {
  let withCookie = false
  let immutable = true
  const upstream = createServer((req, res) => {
    res.setHeader('cache-control', immutable ? 'max-age=31536000, immutable' : 'no-cache')
    if (withCookie) res.setHeader('set-cookie', 'fixture=1')
    res.end('export const value = 1')
  })
  const port = await listen(upstream)
  const gateway = createLocalEnterpriseGateway({ ...profile(port), mode: 'dev' }, 'fixture-secret')
  const gatewayPort = await listen(gateway)
  const prefix = `/enterprise/_nuxt/@fs${encodeURI(fileURLToPath(new URL('../../../../enterprise/node_modules/.cache/vite/client/deps/', import.meta.url)))}`
  try {
    for (const file of ['reka-ui.js?v=1234abcd', 'chunk-ABCD1234.js']) {
      const result = await request(gatewayPort, prefix + file, { host: 'hzy0.isme.dev' })
      assert.equal(result.headers['cache-control'], 'private, max-age=31536000, immutable')
      assert.equal(result.headers['cloudflare-cdn-cache-control'], 'no-store')
      assert.equal(result.headers['cdn-cache-control'], 'no-store')
    }
    for (const path of [prefix + 'reka-ui.js', prefix + 'reka-ui.js?v=old', prefix + 'reka-ui.js?v=1234abcd&t=1', prefix + 'reka-ui.js.map?v=1234abcd', '/enterprise/_nuxt/app.vue?v=1234abcd']) {
      const result = await request(gatewayPort, path, { host: 'hzy0.isme.dev' })
      assert.equal(result.headers['cache-control'], 'no-store')
    }
    withCookie = true
    assert.equal((await request(gatewayPort, prefix + 'reka-ui.js?v=1234abcd', { host: 'hzy0.isme.dev' })).headers['cache-control'], 'no-store')
    withCookie = false; immutable = false
    assert.equal((await request(gatewayPort, prefix + 'reka-ui.js?v=1234abcd', { host: 'hzy0.isme.dev' })).headers['cache-control'], 'no-store')
  } finally { await close(gateway); await close(upstream) }
})

test('Host brand asset is served only through the explicit Enterprise path', async () => {
  let upstreamPath
  const upstream = createServer((req, res) => { upstreamPath = req.url; res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<svg/>') })
  const port = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(port), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const allowed = await request(gatewayPort, '/enterprise/logo.svg', { host: 'hzy0.isme.dev' })
    assert.equal(allowed.statusCode, 200)
    assert.equal(upstreamPath, '/logo.svg')
    assert.equal((await request(gatewayPort, '/logo.svg', { host: 'hzy0.isme.dev' })).statusCode, 404)
  } finally { await close(gateway); await close(upstream) }
})

test('HTTP streams body, preserves gzip bytes and multiple Set-Cookie, and replaces trusted context', async () => {
  const compressed = gzipSync(Buffer.from('gzip-body'))
  const upstream = createServer((req, res) => { let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => { res.setHeader('set-cookie', ['a=1', 'b=2']); res.setHeader('connection', 'x-drop'); res.setHeader('x-drop', 'secret'); res.setHeader('content-encoding', 'gzip'); res.setHeader('x-test-context', JSON.stringify({ url: req.url, body, tenant: req.headers['x-hzy-tenant'], gateway: req.headers['x-hzy-gateway'] })); res.end(compressed) }) })
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/enterprise/api/navigation', method: 'POST', headers: { host: 'hzy0.isme.dev', 'x-hzy-tenant': 'forged', 'x-forwarded-for': 'forged', connection: 'keep-alive, x-drop', 'content-type': 'text/plain' } }, response => { const chunks = []; response.on('data', chunk => { chunks.push(chunk) }); response.on('end', () => resolve({ response, body: Buffer.concat(chunks) })) })
      req.once('error', reject); req.end('hello')
    })
    assert.equal(result.response.statusCode, 200)
    assert.deepEqual(result.response.headers['set-cookie'], ['a=1', 'b=2'])
    assert.equal(result.response.headers['x-drop'], undefined)
    assert.equal(result.response.headers['x-hzy-tenant'], undefined)
    assert.equal(result.response.headers['content-encoding'], 'gzip')
    assert.deepEqual(result.body, compressed)
    assert.deepEqual(JSON.parse(result.response.headers['x-test-context']), { url: '/enterprise/api/navigation', body: 'hello', tenant: 'C000001', gateway: 'tenant-gateway' })
  } finally { await close(gateway); await close(upstream) }
})

test('DELETE with JSON body reaches the Enterprise Host intact', async () => {
  let received = ''
  const upstream = createServer((req, res) => {
    req.on('data', chunk => { received += chunk })
    req.on('end', () => { res.writeHead(204); res.end() })
  })
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  const body = JSON.stringify({ uid: 'test' })
  try {
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/aims/api/v1/projects/262/members', method: 'DELETE', headers: { host: 'hzy0.isme.dev', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, resolve)
      req.once('error', reject)
      req.end(body)
    })
    response.resume()
    assert.equal(response.statusCode, 204)
    assert.equal(received, body)
    received = ''
    const empty = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/aims/api/v1/projects/262/members', method: 'DELETE', headers: { host: 'hzy0.isme.dev' } }, resolve)
      req.once('error', reject)
      req.end()
    })
    empty.resume()
    assert.equal(empty.statusCode, 204)
    assert.equal(received, '')
  } finally { await close(gateway); await close(upstream) }
})

test('local Gateway strips forged dial and emits only the pinned loopback transport with canonical binding', async () => {
  let observed
  const upstream = createServer((req, res) => { observed = req.headers; res.end('ok') })
  const upstreamPort = await listen(upstream)
  const base = profile(upstreamPort)
  const gateway = createLocalEnterpriseGateway({ ...base, runtime: { ...base.runtime,
    transportMode: 'loopback', dialEndpoint: 'http://127.0.0.1:18084' } }, 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const response = await request(gatewayPort, '/enterprise/api/navigation', {
      host: 'hzy0.isme.dev', 'x-hzy-local-runtime-dial-url': 'http://evil.test'
    })
    assert.equal(response.statusCode, 200)
    assert.equal(observed['x-hzy-data-runtime-url'], 'https://hzy-test-runtime.isme.dev')
    assert.equal(observed['x-hzy-local-runtime-dial-url'], 'http://127.0.0.1:18084')
  } finally { await close(gateway); await close(upstream) }
})

test('aborting the client request cancels the upstream request', async () => {
  let upstreamClosed = false
  let upstreamStarted
  const started = new Promise(resolve => { upstreamStarted = resolve })
  const upstream = createServer(req => { upstreamStarted(); req.once('close', () => { upstreamClosed = true }); req.resume() })
  const upstreamPort = await listen(upstream); const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret'); const gatewayPort = await listen(gateway)
  try {
    const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/enterprise/api/navigation', headers: { host: 'hzy0.isme.dev' } })
    req.once('error', () => {}); req.end(); await started; req.destroy(); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(upstreamClosed, true)
  } finally { await close(gateway); await close(upstream) }
})

test('HTTP rejects alternate Host, absolute-form target, internal path and forged context never reaches upstream', async () => {
  const upstream = createServer((req, res) => res.end('unexpected'))
  const upstreamPort = await listen(upstream); const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret'); const gatewayPort = await listen(gateway)
  try {
    for (const [path, host] of [['/enterprise/', 'evil.test'], ['http://hzy0.isme.dev/enterprise/', 'hzy0.isme.dev']]) {
      const response = await request(gatewayPort, path, { host })
      assert.ok([404, 503].includes(response.statusCode))
    }
    for (const path of ['/enterprise/api/internal/x', '/_nitro/tasks/probe', '/enterprise/api%2Finternal/x']) {
      assert.equal((await request(gatewayPort, path, { host: 'hzy0.isme.dev' })).statusCode, 404)
    }
  } finally { await close(gateway); await close(upstream) }
})

test('Host entry is registered and compatibility redirects are temporary and read-only', async () => {
  const upstream = createServer((req,res) => { res.end('host-home') })
  const port = await listen(upstream), gateway = createLocalEnterpriseGateway(profile(port), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    for (const method of ['GET','HEAD']) {
      assert.equal((await request(gatewayPort,'/',{host:'hzy0.isme.dev'},method)).statusCode,302)
      assert.equal((await request(gatewayPort,'/enterprise',{host:'hzy0.isme.dev'},method)).statusCode,200)
      const shell = await request(gatewayPort, '/shell/aims?target=%2Faims%2Fprojects', { host: 'hzy0.isme.dev' }, method)
      assert.equal(shell.statusCode, 307)
      assert.equal(shell.headers.location, '/aims/projects')
      assert.equal(shell.headers['cache-control'], 'no-store')
      const enterpriseSlash = await request(gatewayPort, '/enterprise/', { host: 'hzy0.isme.dev' }, method)
      assert.equal(enterpriseSlash.statusCode, 302)
      assert.equal(enterpriseSlash.headers.location, '/enterprise')
    }
    for (const path of ['/','/enterprise','/enterprise/']) assert.equal((await request(gatewayPort,path,{host:'hzy0.isme.dev'},'POST')).statusCode,405)
    assert.equal((await request(gatewayPort, '/shell/aims?target=%2Faims%2Fprojects', { host: 'hzy0.isme.dev' }, 'OPTIONS')).statusCode, 405)
  } finally { await close(gateway); await close(upstream) }
})

test('WebSocket upgrade requires exact hzy0 Origin and preserves upgrade handshake', async () => {
  const upstream = createServer(); upstream.on('upgrade', (req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Hzy-Leak: no\r\n\r\n'); socket.end() })
  const upstreamPort = await listen(upstream); const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret'); const gatewayPort = await listen(gateway)
  try {
    const ok = await upgrade(gatewayPort, 'https://hzy0.isme.dev', '/__vite_ws')
    assert.match(ok, /101 Switching Protocols/); assert.match(ok, /Connection: Upgrade/); assert.match(ok, /Upgrade: websocket/); assert.doesNotMatch(ok, /X-Hzy-Leak/i)
    const rejected = await upgrade(gatewayPort, 'https://evil.test', '/__vite_ws')
    assert.equal(rejected, '')
  } finally { await close(gateway); await close(upstream) }
})

test('v2 Collab upgrade uses only the pinned socket route and never forwards Gateway or browser credentials', async () => {
  let observed
  const enterprise = createServer((req, res) => res.end('enterprise'))
  const collab = createServer()
  collab.on('upgrade', (req, socket) => {
    observed = { path: req.url, headers: req.headers }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.end()
  })
  const enterprisePort = await listen(enterprise)
  const collabPort = await listen(collab)
  const base = profile(enterprisePort)
  const gateway = createLocalEnterpriseGateway({ ...base,
    features: { codocsSnapshotV2: true, codocsCollaborationV2: true },
    listeners: { ...base.listeners, collab: { host: '127.0.0.1', port: collabPort } }
  }, 'fixture-gateway-secret')
  const gatewayPort = await listen(gateway)
  try {
    assert.equal((await request(gatewayPort, '/codocs/ws', { host: 'hzy0.isme.dev' })).statusCode, 426)
    const ok = await upgrade(gatewayPort, 'https://hzy0.isme.dev', '/codocs/ws?documentName=doc%3Adoc-1', {
      cookie: 'session=fixture', authorization: 'Bearer fixture', 'x-hzy-gateway-token': 'forged'
    })
    assert.match(ok, /101 Switching Protocols/)
    assert.equal(observed.path, '/codocs/ws?documentName=doc%3Adoc-1')
    assert.equal(observed.headers.origin, 'https://hzy0.isme.dev')
    for (const key of ['cookie', 'authorization', 'x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-local-runtime-dial-url']) {
      assert.equal(observed.headers[key], undefined)
    }
    observed = null
    assert.equal(await upgrade(gatewayPort, 'https://evil.test', '/codocs/ws'), '')
    assert.equal(await upgrade(gatewayPort, 'https://hzy0.isme.dev', '/codocs/ws/extra'), '')
    assert.equal(observed, null)
  } finally {
    await close(gateway)
    await close(collab)
    await close(enterprise)
  }
})

test('Collab service token bridge accepts only the exact loopback client and emits a bound Console request', async () => {
  const base = profile(23122)
  const observed = []
  const gateway = createLocalEnterpriseGateway({ ...base,
    features: { codocsSnapshotV2: true, codocsCollaborationV2: true },
    listeners: { ...base.listeners, collab: { host: '127.0.0.1', port: 23131 } }
  }, 'fixture-gateway-secret', {
    async headers() { return new Headers({ 'x-hzy-gateway-token': 'fixture-gateway-secret', cookie: 'must-strip' }) }
  }, {
    collabTokenSecret: 'fixture-collab-secret',
    async collabTokenFetch(url, init) {
      observed.push({ url, headers: Object.fromEntries(init.headers), body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ access_token: 'fixture-short-token', token_type: 'Bearer', expires_in: 900,
        scope: 'codocs:collaboration-snapshots:read' }), { headers: { 'content-type': 'application/json' } })
    }
  })
  const port = await listen(gateway)
  const body = { grant_type: 'client_credentials', client_id: 'collab.runtime', client_secret: 'fixture-collab-secret',
    audience: 'data-runtime', scope: 'codocs:collaboration-snapshots:read', source_binding: 'service-client-policy' }
  try {
    const path = '/__hzy0/collab-token'
    assert.equal((await postJson(port, path, body, 'hzy0.isme.dev')).status, 404)
    assert.equal((await postJson(port, path, { ...body, client_secret: 'wrong' })).status, 401)
    assert.equal((await postJson(port, path, { ...body, scope: 'codocs:personal-documents:edit' })).status, 403)
    assert.equal((await postJson(port, path, { ...body, audience: 'tenant-runtime' })).status, 403)
    assert.equal((await postJson(port, path, { ...body, source_binding: 'trusted-gateway' })).status, 403)
    assert.equal((await postJson(port, `${path}?x=1`, body)).status, 404)
    assert.equal(observed.length, 0)
    const valid = await postJson(port, path, body)
    assert.equal(valid.status, 200)
    assert.equal(valid.headers['cache-control'], 'no-store')
    assert.equal(valid.body.access_token, 'fixture-short-token')
    assert.equal(observed.length, 1)
    assert.equal(observed[0].url, 'http://127.0.0.1:23100/console/oauth/token')
    assert.equal(observed[0].headers['x-hzy-app-code'], 'collab')
    assert.equal(observed[0].headers['x-hzy-deployment'], 'C000001-test-collab')
    assert.equal(observed[0].headers.cookie, undefined)
    assert.equal(observed[0].body.client_secret, 'fixture-collab-secret')
  } finally { await close(gateway) }
  const disabled = createLocalEnterpriseGateway(base, 'fixture-gateway-secret', { headers: async () => new Headers() }, {
    collabTokenSecret: 'fixture-collab-secret', collabTokenFetch: async () => { throw Error('must stay closed') }
  })
  const disabledPort = await listen(disabled)
  try { assert.equal((await postJson(disabledPort, '/__hzy0/collab-token', body)).status, 404) }
  finally { await close(disabled) }
})

test('Dev error bodies never expose request credentials and preserve failure status', async () => {
  const upstream = createServer((req, res) => {
    res.writeHead(Number(req.headers['x-fixture-status']), { 'content-type': 'text/html', 'x-diagnostic': 'fixture-secret' })
    res.end(`<html>${req.headers['x-hzy-gateway-token']}</html>`)
  })
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    for (const status of [400, 401, 403, 404, 503]) {
      const result = await new Promise((resolve, reject) => {
        const req = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/enterprise/api/navigation', headers: { host: 'hzy0.isme.dev', 'x-fixture-status': status } }, res => {
          let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
        })
        req.once('error', reject); req.end()
      })
      assert.equal(result.status, status)
      assert.equal(result.headers['x-diagnostic'], undefined)
      assert.doesNotMatch(result.body, /fixture-secret|<html>/)
      assert.equal(JSON.parse(result.body).code, 'hzy0_upstream_error')
    }
  } finally { await close(gateway); await close(upstream) }
})

test('navigation failures render safe HTML while API and assets retain JSON', async () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  const upstream = createServer((req, res) => {
    const status = Number(req.headers['x-fixture-status'] || 503)
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '2',
      'set-cookie': 'hzy_access_token=; Max-Age=0; Path=/; HttpOnly; Secure', 'x-diagnostic': 'PRIVATE' })
    res.end(JSON.stringify({ statusCode: status, code: 'unreviewed', correlationId: id, message: 'PRIVATE', stack: 'PRIVATE' }))
  })
  const port = await listen(upstream), gateway = createLocalEnterpriseGateway(profile(port), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  const read = (path, method, headers = {}) => new Promise((resolve, reject) => {
    httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path, method, headers: { host: 'hzy0.isme.dev', ...headers } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject).end()
  })
  try {
    for (const status of [401, 403, 409, 503, 418]) {
      const page = await read('/aims/projects', 'GET', { 'sec-fetch-mode': 'navigate', 'x-fixture-status': String(status) })
      assert.equal(page.status, status)
      assert.match(page.headers['content-type'], /^text\/html/)
      assert.equal(page.headers['cache-control'], 'no-store')
      assert.equal(page.headers['x-diagnostic'], undefined)
      assert.ok(page.body.includes(id))
      assert.doesNotMatch(page.body, /PRIVATE|unreviewed|fixture-secret/)
      if (status === 503 || status === 409) assert.equal(page.headers['retry-after'], '2')
      assert.equal(page.headers['set-cookie']?.length, 1)
    }
    const head = await read('/aims/projects', 'HEAD', { accept: 'text/html' })
    assert.equal(head.status, 503)
    assert.equal(head.body, '')
    assert.match(head.headers['content-type'], /^text\/html/)
    for (const path of ['/enterprise/api/navigation', '/enterprise/_nuxt/app.js']) {
      const result = await read(path, 'GET', { accept: 'text/html', 'sec-fetch-mode': 'navigate' })
      assert.match(result.headers['content-type'], /^application\/json/)
      assert.equal(JSON.parse(result.body).code, 'hzy0_upstream_error')
    }
  } finally { await close(gateway); await close(upstream) }
})

test('formal conflict JSON retains reviewed code, retry and cookie clearing through HTTP', async () => {
  const upstream = createServer((req,res) => {
    res.writeHead(409, {'content-type':'application/json','retry-after':'2','set-cookie':'hzy_access_token=; Max-Age=0; Path=/; HttpOnly; Secure'})
    res.end(JSON.stringify({data:{code:'enterprise_directory_changed',currentVersion:4,secret:'SECRET'},stack:'SECRET'}))
  })
  const port = await listen(upstream), gateway = createLocalEnterpriseGateway(profile(port),'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const result = await new Promise((resolve,reject) => {
      httpRequest({hostname:'127.0.0.1',port:gatewayPort,path:'/enterprise/api/navigation',headers:{host:'hzy0.isme.dev'}},res=>{
        let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}))
      }).on('error',reject).end()
    })
    assert.equal(result.status,409)
    assert.equal(JSON.parse(result.body).data.code,'enterprise_directory_changed')
    assert.equal(result.headers['retry-after'],'2')
    assert.equal(result.headers['set-cookie'].length,1)
    assert.doesNotMatch(result.body,/SECRET/)
  } finally { await close(gateway); await close(upstream) }
})

test('only explicit shared Foundation directory routes pass the local gateway', async () => {
  const upstream = createServer((req, res) => { res.statusCode = 204; res.end() })
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    for (const path of ['/api/directory/users?pageSize=20', '/api/directory/projects', '/api/directory/business-domains', '/api/directory/me', '/api/directory/departments', '/api/_nuxt_icon/lucide?icons=menu', '/api/_nuxt_icon/lucide.json?icons=menu,search', '/api/_nuxt_icon/simple-icons.json?icons=gitlab']) {
      assert.equal((await request(gatewayPort, path, { host: 'hzy0.isme.dev' })).statusCode, 204)
      assert.equal((await request(gatewayPort, path, { host: 'hzy0.isme.dev' }, 'POST')).statusCode, 404)
    }
    assert.equal((await request(gatewayPort, '/api/directory/users/batch', { host: 'hzy0.isme.dev' }, 'POST')).statusCode, 204)
    assert.equal((await request(gatewayPort, '/api/directory/users/batch', { host: 'hzy0.isme.dev' })).statusCode, 404)
    for (const path of ['/api/directory/user-departments', '/api/directory/departments/secret', '/api/directory/departments/secret/members', '/api/directory/user-departments/secret', '/api/internal/test', '/api/admin', '/api/_nuxt_icon/../internal']) {
      assert.ok([404, 503].includes((await request(gatewayPort, path, { host: 'hzy0.isme.dev' })).statusCode))
    }
  } finally { await close(gateway); await close(upstream) }
})

test('only exact signed-in notification proxy routes pass the local gateway', async () => {
  const upstream = createServer((req, res) => { res.statusCode = 204; res.end() })
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const headers = { host: 'hzy0.isme.dev' }
    for (const path of ['/api/notifications', '/api/notifications?status=unread', '/api/notifications/summary', '/api/notifications/notif_123/detail']) {
      assert.equal((await request(gatewayPort, path, headers)).statusCode, 204, path)
      assert.notEqual((await request(gatewayPort, path, headers, 'POST')).statusCode, 204, `${path} POST`)
    }
    for (const path of ['/api/notifications/read-all', '/api/notifications/notif_123/read', '/api/notifications/notif_123/archive']) {
      assert.equal((await request(gatewayPort, path, headers, 'POST')).statusCode, 204, path)
      assert.notEqual((await request(gatewayPort, path, headers)).statusCode, 204, `${path} GET`)
    }
    for (const path of ['/api/notifications/notif_123/delete', '/api/notifications/notif_123/read/extra', '/api/notifications/notif%2f123/detail', '/api/notifications/admin', '/api/notifications/other/summary']) {
      assert.notEqual((await request(gatewayPort, path, headers)).statusCode, 204, path)
      assert.notEqual((await request(gatewayPort, path, headers, 'POST')).statusCode, 204, `${path} POST`)
    }
  } finally { await close(gateway); await close(upstream) }
})

test('Codocs editor shell uses only the fixed test Gateway and never forwards credentials', async t => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response('<html>editor</html>', {
      headers: { 'content-type': 'text/html', 'set-cookie': 'should-not-pass=1' }
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const upstream = createServer((req, res) => res.end('enterprise'))
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const response = await request(gatewayPort, '/codocs/embed/editor/doc_1', {
      host: 'hzy0.isme.dev', cookie: 'private-session=fixture', authorization: 'Bearer fixture'
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['set-cookie'], undefined)
    assert.deepEqual(calls.map(call => call.url), ['http://127.0.0.1:23130/codocs/embed/editor/doc_1'])
    assert.equal(calls[0].init.headers.cookie, undefined)
    assert.equal(calls[0].init.headers.authorization, undefined)
    const icon = await request(gatewayPort, '/codocs/api/_nuxt_icon/lucide.json?icons=save', { host: 'hzy0.isme.dev', cookie: 'private-session=fixture' })
    assert.equal(icon.statusCode, 200)
    assert.equal(calls[1].url, 'http://127.0.0.1:23130/codocs/api/_nuxt_icon/lucide.json?icons=save')
    assert.equal(calls[1].init.headers.cookie, undefined)
    assert.equal((await request(gatewayPort, '/codocs/embed/editor/doc_1', { host: 'hzy0.isme.dev' }, 'POST')).statusCode, 405)
    assert.equal((await request(gatewayPort, '/codocs/api/_nuxt_icon/lucide.json?icons=save', { host: 'hzy0.isme.dev' }, 'POST')).statusCode, 405)
    await request(gatewayPort, '/codocs/embed/editor/../admin', { host: 'hzy0.isme.dev' })
    assert.equal(calls.length, 2)
  } finally { await close(gateway); await close(upstream) }
})

test('Codocs editor navigation preserves a failed upstream status in safe HTML', async t => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('PRIVATE', { status: 403, headers: { 'content-type': 'text/html' } })
  t.after(() => { globalThis.fetch = originalFetch })
  const upstream = createServer((req, res) => res.end('enterprise'))
  const upstreamPort = await listen(upstream)
  const gateway = createLocalEnterpriseGateway(profile(upstreamPort), 'fixture-secret')
  const gatewayPort = await listen(gateway)
  try {
    const result = await new Promise((resolve, reject) => {
      httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: '/codocs/embed/editor/doc_1',
        headers: { host: 'hzy0.isme.dev', 'sec-fetch-mode': 'navigate' } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }))
      }).on('error', reject).end()
    })
    assert.equal(result.status, 403)
    assert.match(result.type, /^text\/html/)
    assert.match(result.body, /没有访问此页面的权限/)
    assert.doesNotMatch(result.body, /PRIVATE/)
  } finally { await close(gateway); await close(upstream) }
})

function request(port, path, headers, method = 'GET') { return new Promise((resolve, reject) => { const req = httpRequest({ hostname: '127.0.0.1', port, path, headers, method }, res => { res.resume(); res.once('end', () => resolve(res)) }); req.once('error', reject); req.end() }) }
function postJson(port, path, body, host = `127.0.0.1:${port}`) { return new Promise((resolve, reject) => { const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { host, 'content-type': 'application/json' } }, res => { let raw = ''; res.on('data', chunk => { raw += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) })) }); req.once('error', reject); req.end(JSON.stringify(body)) }) }
function upgrade(port, origin, path, extraHeaders = {}) { return new Promise(resolve => { const socket = connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: hzy0.isme.dev\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${Object.entries(extraHeaders).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`)); let data = ''; socket.on('data', chunk => { data += chunk }); socket.on('close', () => resolve(data)); setTimeout(() => { socket.destroy(); resolve(data) }, 500) }) }
