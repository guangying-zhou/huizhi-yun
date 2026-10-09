#!/usr/bin/env node
import { createServer, request as httpRequest } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { buildForwardHeaders, preserveTrustedServiceTokenSource } from '../cloudflare/tenant-gateway/src/index.js'
import { validateHealth, validateEnv } from './local.mjs'
import { resolveLocalLogin } from './local-login.mjs'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
export const localTenant = Object.freeze({ tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', environment: 'test',
  apps: { console: { deploymentCode: 'wiztek-test-console' }, people: { deploymentCode: 'C000001-test-people' } } })

export function localApplicationCatalog(payload) {
  if (payload?.code !== 0 || !Array.isArray(payload.data)) return payload
  // Change navigation transport only, after Console has filtered authorization.
  // Never add an application or alter permissions from the signed test policy.
  return { ...payload, data: payload.data.map(app => app?.appCode === 'people'
    ? { ...app, homeUrl: 'http://127.0.0.1:3007/people/', basePath: '/people/' } : app) }
}

export function localRequestHeaders(request, app, gatewaySecret, bootstrapToken, login) {
  const url = new URL(request.url), port = app === 'console' ? '3000' : '3007'
  if (!['console', 'people'].includes(app) || url.origin !== `http://127.0.0.1:${port}`
    || !url.pathname.startsWith(`/${app}/`) || !gatewaySecret || !bootstrapToken
    || /\/(?:_nitro|api\/internal)(?:\/|$)/.test(url.pathname)) throw Error('Local gateway route rejected')
  const env = { HZY_CLOUDFLARE_INTERNAL_TOKEN: gatewaySecret,
    HZY_CONSOLE_ORIGIN: 'http://127.0.0.1:3000', HZY_PEOPLE_ORIGIN: 'http://127.0.0.1:3007' }
  const tenant = { ...localTenant, login: login ? { mode: 'oidc', enabledProviders: ['oidc'], oidc: login } : undefined }
  const headers = buildForwardHeaders(request, env, tenant, `/${app}/`, app)
  // Reuse the production exact source-binding check on the Console-prefixed endpoint.
  if (app === 'console' && url.pathname === '/console/oauth/token') {
    preserveTrustedServiceTokenSource(new Request('http://127.0.0.1:3000/oauth/token', {
      method: request.method, headers: request.headers
    }), env, localTenant, headers)
  }
  // Explicit local transport adapter; Cloudflare continues to reject loopback endpoints.
  headers.set('x-hzy-data-runtime-url', 'http://127.0.0.1:18080')
  headers.set('x-hzy-data-runtime-code', 'c000001-test-tenant-runtime')
  headers.set('x-hzy-data-runtime-audience', 'data-runtime')
  headers.set('x-hzy-data-runtime-token', bootstrapToken)
  headers.set('x-forwarded-port', port)
  headers.delete('connection')
  headers.delete('transfer-encoding')
  headers.delete('content-length')
  return headers
}

async function remoteContext(mode) {
  const { stdout } = await execute('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@gitlab.wiztek.cn',
    `node /wiztek/hzy-test/local-context.mjs ${mode}`], { timeout: 25000, maxBuffer: 65536 })
  return JSON.parse(stdout)
}

async function main() {
  if (process.argv[2] !== '--start' || Number(process.versions.node.split('.')[0]) !== 24) throw Error('Use Node 24 and --start')
  const health = await fetch('http://127.0.0.1:18080/runtime/health').then(r => r.json())
  validateHealth(health)
  const consoleEnv = { ...parseEnv(readFileSync(`${root}/console/.env.dev`, 'utf8')), ...process.env }
  validateEnv('console', consoleEnv)
  const login = resolveLocalLogin(consoleEnv, consoleEnv.SSO_OIDC_CLIENT_SECRET?.trim()
    ? undefined : await remoteContext('--login'))
  const activation = await remoteContext('--activation')
  const gatewaySecret = randomBytes(32).toString('base64url')
  let cached, pending
  const bootstrap = async () => {
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 20000) return cached.token
    pending ||= remoteContext('--bootstrap').then(data => {
      const c = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url'))
      if (c.iss !== 'https://hzy.wiztek.cn' || c.aud !== 'data-runtime-bootstrap'
        || c.tenant !== localTenant.tenantCode || c.deployment !== localTenant.deploymentCode
        || c.runtimeCode !== 'c000001-test-tenant-runtime' || c.token_use !== 'platform_runtime_bootstrap'
        || Date.parse(data.expiresAt) <= Date.now() + 20000) throw Error('Bootstrap binding')
      cached = data
      return data.token
    }).finally(() => { pending = null })
    return pending
  }
  await bootstrap()
  const servers = [], children = []
  const stop = () => {
    for (const server of servers) server.close()
    for (const child of children) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try { for (const app of ['console', 'people']) {
    const port = app === 'console' ? 3000 : 3007, backend = port + 10000
    const env = { ...parseEnv(readFileSync(`${root}/${app}/.env.dev`, 'utf8')), ...process.env }
    validateEnv(app, env)
    const server = createServer(async (req, res) => {
      try {
        if (req.headers.host === `localhost:${port}` && ['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(308, { location: `http://127.0.0.1:${port}${req.url}`, 'cache-control': 'no-store' }).end(); return
        }
        if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return }
        // Separate local app ports do not host Console Shell. Use its documented
        // standalone mode for HTML navigation; this does not bypass user auth.
        const incoming = new URL(req.url, `http://127.0.0.1:${port}`)
        if (app === 'people' && req.method === 'GET' && req.headers.accept?.includes('text/html')
          && incoming.pathname.startsWith('/people/') && !incoming.pathname.startsWith('/people/api/')
          && !incoming.pathname.startsWith('/people/_nuxt/') && incoming.searchParams.get('standalone') !== '1') {
          incoming.searchParams.set('standalone', '1')
          res.writeHead(308, { location: incoming.pathname + incoming.search, 'cache-control': 'no-store' }).end(); return
        }
        const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers })
        const headers = localRequestHeaders(request, app, gatewaySecret, await bootstrap(), login)
        const response = await fetch(`http://127.0.0.1:${backend}${req.url}`, {
          method: req.method, headers, redirect: 'manual',
          ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' })
        })
        res.statusCode = response.status
        for (const [key, value] of response.headers) {
          if (!['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)
            && !key.startsWith('x-hzy-')) res.setHeader(key, value)
        }
        const cookies = response.headers.getSetCookie()
        if (cookies.length) res.setHeader('set-cookie', cookies)
        res.setHeader('cache-control', 'no-store')
        if (app === 'console' && req.method === 'GET' && response.ok
          && ['/console/api/user/applications', '/console/api/v1/console/user/applications'].includes(incoming.pathname)) {
          res.end(JSON.stringify(localApplicationCatalog(await response.json()))); return
        }
        if (response.body) for await (const chunk of response.body) res.write(chunk)
        res.end()
      } catch {
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end('Local test gateway unavailable')
      }
    })
    server.on('upgrade', async (req, socket, head) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`)
        if (req.headers.host !== `127.0.0.1:${port}` || !url.pathname.startsWith(`/${app}/_nuxt/`)
          || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return }
        const headers = localRequestHeaders(new Request(url, { headers: req.headers }), app, gatewaySecret, await bootstrap(), login)
        headers.set('connection', 'Upgrade')
        headers.set('upgrade', 'websocket')
        const upstream = httpRequest({ hostname: '127.0.0.1', port: backend, path: req.url,
          headers: Object.fromEntries(headers) })
        upstream.once('upgrade', (response, peer, upstreamHead) => {
          const lines = Object.entries(response.headers).filter(([key]) => !key.startsWith('x-hzy-'))
            .map(([key, value]) => `${key}: ${value}`)
          socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
          if (head.length) peer.write(head)
          if (upstreamHead.length) socket.write(upstreamHead)
          socket.pipe(peer).pipe(socket)
          peer.on('error', () => socket.destroy())
          socket.on('error', () => peer.destroy())
        })
        upstream.once('response', () => socket.destroy())
        upstream.once('error', () => socket.destroy())
        upstream.end()
      } catch { socket.destroy() }
    })
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept) })
    servers.push(server)
    const overrides = { HOST: '127.0.0.1', PORT: String(backend), NODE_OPTIONS: '--max-old-space-size=2048',
      VITE_HMR_PORT: app === 'console' ? '24684' : '24685',
      HZY_CLOUDFLARE_INTERNAL_TOKEN: gatewaySecret, HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'true',
      HZY_LOCAL_TEST_GATEWAY_ENABLED: 'true', HZY_PLATFORM_TENANT_CODE: 'C000001',
      HZY_CONSOLE_TOKEN_URL: 'http://127.0.0.1:3000/console/oauth/token',
      HZY_PLATFORM_DEPLOYMENT_CODE: app === 'console' ? 'wiztek-test-console' : 'C000001-test-people',
      HZY_PLATFORM_ENVIRONMENT: 'test', HZY_PLATFORM_URL: 'https://hzy.wiztek.cn' }
    if (app === 'console') Object.assign(overrides, { SSO_OIDC_ENABLE: 'true', SSO_OIDC_ISSUER: login.issuer,
      SSO_OIDC_CLIENT_ID: login.clientId, SSO_OIDC_CLIENT_SECRET: login.clientSecret,
      SSO_OIDC_REDIRECT_URI: 'http://127.0.0.1:3000/console/api/auth/oidc-callback',
      HZY_PLATFORM_RUNTIME_ENABLED: 'true', HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
      HZY_PLATFORM_RUNTIME_TOKEN: activation.runtimeToken, HZY_PLATFORM_LICENSE_TOKEN: activation.licenseToken,
      HZY_PLATFORM_SIGNING_KID: activation.signingKid, HZY_PLATFORM_SIGNING_PUBKEY: activation.signingPubkey,
      HZY_PLATFORM_BUNDLE_CACHE_DIR: '.data/platform-runtime-test-local', HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'true' })
    const child = spawn('pnpm', ['exec', 'nuxt', 'dev', '--dotenv', '.env.dev', '--port', String(backend)], {
      cwd: `${root}/${app}`, env: { ...env, ...overrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    // Do not forward application logs that may include injected request context/secrets.
    child.stdout.resume(); child.stderr.resume()
    child.once('error', stop)
    child.once('exit', stop)
    children.push(child)
    console.log(`${app}: local gateway 127.0.0.1:${port} -> Nuxt 127.0.0.1:${backend}`)
  } } catch (error) { stop(); throw error }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Local gateway stopped; private diagnostics suppressed.'); process.exitCode = 1 })
}
