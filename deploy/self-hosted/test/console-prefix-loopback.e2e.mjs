#!/usr/bin/env node
// Regression: a self-hosted application artifact reaches the local Console through the loopback transport WITH the /console
// base path. The stand-in Console mirrors the real one (NUXT_APP_BASE_URL=/console/): an unprefixed path is answered with a
// 302, /console/oauth/token answers 401 invalid_client for placeholder credentials, and the runtime-config route is served.
// Usage: node console-prefix-loopback.e2e.mjs --app <artifact dir containing .output> [--app-code aims] [--timeout-ms 45000]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const appDir = resolve(value('--app', ''))
const appCode = value('--app-code', 'aims')
const timeoutMs = Number(value('--timeout-ms', '45000'))
const entry = join(appDir, '.output/server/index.mjs')
if (!existsSync(entry)) { console.error(`artifact not found: ${entry}`); process.exit(2) }

const hits = []
const envelope = {
  code: 0,
  data: {
    schemaVersion: 'console-runtime.v1', app: { appCode, appName: appCode },
    console: { baseUrl: 'https://aidcp.wiztek.cn/console', issuer: 'https://aidcp.wiztek.cn/console', tokenUrl: 'https://aidcp.wiztek.cn/console/oauth/token',
      bootstrapTokenUrl: 'https://aidcp.wiztek.cn/console/api/v1/console/bootstrap/token', authMeUrl: 'https://aidcp.wiztek.cn/console/api/v1/console/auth/me',
      directoryApiUrl: 'https://aidcp.wiztek.cn/console/api/v1/console/directory', settingsApiUrl: 'https://aidcp.wiztek.cn/console/api/v1/console/settings',
      integrationsApiUrl: 'https://aidcp.wiztek.cn/console/api/v1/console/integrations', userApplicationsUrl: 'https://aidcp.wiztek.cn/console/api/user/applications' },
    fetchedAt: new Date().toISOString()
  }
}
const consoleServer = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    const url = req.url || ''
    const entryRow = { method: req.method, url, status: 0 }
    hits.push(entryRow)
    if (!url.startsWith('/console/')) { entryRow.status = 302; res.writeHead(302, { location: `/console${url}` }).end(); return }
    if (req.method === 'POST' && url.startsWith('/console/oauth/token')) { entryRow.status = 401; res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_client' })); return }
    entryRow.status = 200
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(url.includes('/runtime/apps/') ? envelope : { code: 0, data: {} }))
  })
})
await new Promise(resolveListen => consoleServer.listen(0, '127.0.0.1', resolveListen))
const consolePort = consoleServer.address().port
const appPort = 20000 + Math.floor(Math.random() * 20000)
const publicConsole = 'https://aidcp.wiztek.cn/console'
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(appPort),
  HZY_APP_RUN_MODE: 'prod', HZY_APP_CODE: appCode, NUXT_APP_BASE_URL: `/${appCode}/`,
  HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: JSON.stringify({ console: `http://127.0.0.1:${consolePort}` }),
  HZY_CONSOLE_URL: publicConsole, HZY_CONSOLE_API_URL: publicConsole, HZY_CONSOLE_TOKEN_URL: `${publicConsole}/oauth/token`,
  NUXT_HZY_SERVICE_CLIENT_TOKEN_URL: `${publicConsole}/oauth/token`, HZY_PLATFORM_ENVIRONMENT: 'prod',
  HZY_SERVICE_CLIENT_ID: `${appCode}.runtime`, HZY_SERVICE_CLIENT_SECRET: 'REPLACE_PLACEHOLDER', HZY_AIMS_SERVICE_CLIENT_ID: `${appCode}.runtime`, HZY_AIMS_SERVICE_CLIENT_SECRET: 'REPLACE_PLACEHOLDER',
  NUXT_HZY_SERVICE_CLIENT_CLIENT_ID: `${appCode}.runtime`, NUXT_HZY_SERVICE_CLIENT_CLIENT_SECRET: 'REPLACE_PLACEHOLDER',
  HZY_CONSOLE_RUNTIME_ENABLED: 'true', NUXT_HZY_CONSOLE_RUNTIME_ENABLED: 'true', NUXT_HZY_CONSOLE_RUNTIME_CONSOLE_API_URL: publicConsole,
  HZY_TENANT_RUNTIME_TENANT: 'C000001', HZY_TENANT_RUNTIME_DEPLOYMENT: 'c000001-prod-tenant-runtime', HZY_DATA_ACCESS_MODE: 'tenant-runtime'
}
const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', chunk => { log += chunk })
child.stderr.on('data', chunk => { log += chunk })
const failures = []
try {
  const deadline = Date.now() + timeoutMs
  const seen = () => ({ config: hits.some(h => h.method === 'GET' && h.url.startsWith(`/console/api/v1/console/runtime/apps/${appCode}/config`)),
    token: hits.some(h => h.method === 'POST' && h.url === '/console/oauth/token') })
  while (Date.now() < deadline && !(seen().config && seen().token)) await new Promise(r => setTimeout(r, 500))
  const state = seen()
  if (!state.config) failures.push('the application never read the Console runtime config under /console/')
  if (!state.token) failures.push('the application never requested a service token from /console/oauth/token')
  const unprefixed = hits.filter(h => !h.url.startsWith('/console/'))
  if (unprefixed.length) failures.push(`unprefixed loopback calls answered with 302: ${unprefixed.map(h => `${h.method} ${h.url}`).join(', ')}`)
  if (/runtime config load failed: Found|Failed to fetch runtime config[^\n]*: Found/.test(log)) failures.push('application log reports a 302 “Found” from Console')
  console.log(JSON.stringify({ appCode, consolePort, hits, prefixedOk: state, unprefixedCount: unprefixed.length }, null, 1))
} finally {
  child.kill('SIGTERM')
  consoleServer.close()
}
if (failures.length) { console.error(`FAIL:\n- ${failures.join('\n- ')}\n--- app log tail ---\n${log.split('\n').slice(-25).join('\n')}`); process.exit(1) }
console.log('PASS: loopback Console calls keep /console and get the Console business response')
