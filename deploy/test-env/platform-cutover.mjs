#!/usr/bin/env node
// PM2 reload does not reliably replace an existing script/cwd. Recreate only dev.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const root = '/wiztek/hzy-test'
const source = `${root}/platform-release-5f898581/platform`
if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected invocation')
const config = JSON.parse(fs.readFileSync(`${root}/platform-dev.config.json`, 'utf8'))
const app = config.apps[0]
if (app.name !== 'hzy-platform-dev' || app.cwd !== source || app.env.DB_NAME !== 'hzy_platform_dev' || app.env.PORT !== '3011' || Object.keys(app.env).some(k => k !== k.toUpperCase())) throw new Error('Unsafe process definition')
const completePath = `${root}/platform-upgrade-complete.json`
if (fs.existsSync(completePath) && JSON.parse(fs.readFileSync(completePath, 'utf8')).cutoverVerifiedAt) throw new Error('Cutover already verified; refusing to restart it')
const receipt = JSON.parse(fs.readFileSync(fs.existsSync(`${root}/platform-upgrade-migrated.json`) ? `${root}/platform-upgrade-migrated.json` : completePath, 'utf8'))
const run = args => execFileSync('pm2', args, { stdio: 'pipe' })
const token = app.env.HZY_CLOUDFLARE_INTERNAL_TOKEN || app.env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim()
if (!token) throw new Error('Missing development credential')
run(['delete', 'hzy-platform-dev'])
try {
  run(['start', `${root}/platform-dev.config.json`, '--only', 'hzy-platform-dev'])
  let verified = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const processes = JSON.parse(run(['jlist']))
      const active = processes.find(p => p.name === 'hzy-platform-dev')
      if (active?.pm2_env?.pm_cwd !== source || active?.pm2_env?.pm_exec_path !== `${source}/.output/server/index.mjs` || active?.pm2_env?.watch !== false) throw new Error('Wrong deployed artifact')
      const response = await fetch('http://127.0.0.1:3011/api/platform/diagnostics', { signal: AbortSignal.timeout(5000) })
      const diag = await response.json()
      if (!response.ok || diag.data?.database?.databaseName !== 'hzy_platform_dev' || !diag.data?.signing?.privateKeyUsable || diag.data.signing.kid !== receipt.signingKid) throw new Error('Readiness failed')
      const bootstrap = await fetch('http://127.0.0.1:3011/api/platform/internal/tenant-gateway/runtime-bootstrap-token', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantCode: 'HTEST001', environment: 'test', appCode: 'console' }), signal: AbortSignal.timeout(5000)
      })
      if (bootstrap.status !== 409) throw new Error('Bootstrap endpoint failed')
      verified = true
      break
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!verified) throw new Error('Cutover verification failed')
  if (fs.existsSync(completePath)) fs.renameSync(completePath, `${root}/platform-upgrade-pre-cutover.json`)
  fs.writeFileSync(`${root}/platform-upgrade-complete.json`, JSON.stringify({ ...receipt, cutoverVerifiedAt: new Date().toISOString(), deployedWorkdir: source, authenticatedBootstrapStatus: 409 }, null, 2), { mode: 0o600, flag: 'wx' })
  console.log('Actual development artifact, database, signing key, watch=false and bootstrap HTTP 409 all verified.')
} catch {
  try { run(['delete', 'hzy-platform-dev']) } catch {}
  run(['start', `${root}/platform-rollback.config.json`, '--only', 'hzy-platform-dev'])
  console.error('Cutover failed; original development code restored.')
  process.exitCode = 1
}
