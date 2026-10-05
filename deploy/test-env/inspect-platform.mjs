#!/usr/bin/env node
// Read-only inspection. Deliberately emit only non-secret diagnostics.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const list = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }))
const app = list.find(p => p.name === 'hzy-platform-dev')
if (!app?.pid) throw new Error('Development Platform is not running')
const env = Object.fromEntries(fs.readFileSync(`/proc/${app.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev') throw new Error('Refusing unexpected Platform database')
console.log(JSON.stringify({ database: env.DB_NAME, port: env.PORT, workdir: app.pm2_env.pm_cwd,
  internalCredentialNames: Object.keys(env).filter(k => /INTERNAL.*TOKEN|PLATFORM.*SERVICE.*TOKEN/.test(k)) }))
const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim() || env.HZY_CONSOLE_PLATFORM_SERVICE_TOKEN || env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
if (token) {
  const response = await fetch('http://127.0.0.1:3011/api/platform/internal/tenant-gateway/runtime-bootstrap-token', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-hzy-internal-principal': 'console-runtime-bootstrap', 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode: 'C000001', environment: 'test', appCode: 'console' })
  })
  console.log(JSON.stringify({ authenticatedBootstrapStatus: response.status, contentType: response.headers.get('content-type') }))
}
const response = await fetch('http://127.0.0.1:3011/api/platform/diagnostics')
const diagnostics = await response.json().catch(() => ({}))
console.log(JSON.stringify({ diagnosticsStatus: response.status, diagnostics }))
