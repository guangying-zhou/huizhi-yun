// Temporary C000001/test lease switch for outage-grace acceptance on the
// development Platform. Run on gitlab.wiztek.cn: `node platform-policy-test-lease.mjs <ms>`.
// Only HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS changes; the PM2 dump is NOT
// updated, so a server restart returns to the persisted 26-hour lease.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Follows the live release (deployment-receipt.json is checked below).
const root = process.env.HZY_PLATFORM_RELEASE_ROOT || '/wiztek/hzy-test/platform-candidates/console-service-key-20260923'
const cwd = `${root}/platform`
const name = 'hzy-platform-dev'
const allowed = new Set(['1200000', '93600000'])
const lease = process.argv[2]
if (!allowed.has(lease)) throw Error('lease must be 1200000 (acceptance) or 93600000 (restore)')
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pm = args => execFileSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const processes = () => JSON.parse(pm(['jlist']))
const receipt = JSON.parse(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
const all = processes()
const live = all.find(p => p.name === name)
if (!live?.pid || live.pm2_env.pm_exec_path !== receipt.candidateEntry || hash(receipt.candidateEntry) !== receipt.candidateHash
  || live.pm2_env.exec_mode !== 'fork_mode' || live.pm2_env.watch !== false) throw Error('running release mismatch')
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011' || !allowed.has(env.HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS)) throw Error('runtime binding mismatch')
const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key)
  && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(key)))
const settings = Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay',
  'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format',
  'node_args', 'args', 'shutdown_with_message', 'treekill', 'autorestart']
  .filter(key => live.pm2_env[key] !== undefined).map(key => [key, live.pm2_env[key]]))
const app = { ...settings, name, cwd, script: receipt.candidateEntry, interpreter: live.pm2_env.exec_interpreter,
  out_file: live.pm2_env.pm_out_log_path, error_file: live.pm2_env.pm_err_log_path, exec_mode: 'fork', instances: 1, watch: false, env: cleanEnv }
const attempt = fs.mkdtempSync(`${root}/lease-`)
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
save(`${attempt}/rollback.config.json`, { apps: [app] })
save(`${attempt}/candidate.config.json`, { apps: [{ ...app, env: { ...cleanEnv, HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS: lease } }] })
const others = all.filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim() || env.PLATFORM_INTERNAL_SERVICE_TOKEN
if (!token) throw Error('existing service credential missing')
const require = createRequire(`${cwd}/package.json`)
const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
let key
try {
  const [rows] = await connection.query("SELECT kid, public_key FROM platform_signing_keys WHERE status='active' AND alg='Ed25519' ORDER BY activated_at DESC,id DESC LIMIT 1")
  key = rows[0]
} finally { await connection.end() }
if (!key) throw Error('active signing key missing')
const request = (target, authenticated) => fetch(`http://127.0.0.1:3011${target}`, { redirect: 'error', signal: AbortSignal.timeout(90000),
  headers: authenticated ? { authorization: `Bearer ${token}` } : {} })
let stage = 'switch'
try {
  pm(['delete', name])
  pm(['start', `${attempt}/candidate.config.json`, '--only', name])
  let healthy = false
  for (let index = 0; index < 30 && !healthy; index++) {
    try { const response = await request('/api/health'); healthy = response.status === 200; await response.body?.cancel() } catch {}
    if (!healthy) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!healthy) throw Error('health failed')
  stage = 'signed lease'
  const response = await request('/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console&format=hzy-policy-envelope.v1', true)
  if (response.status !== 200) throw Error('delivery failed')
  const { verifyPolicyEnvelope } = await import(pathToFileURL(`${cwd}/packages/authz-core/src/policy-envelope.ts`))
  const body = verifyPolicyEnvelope((await response.json()).data, { kid: key.kid, publicKey: key.public_key },
    { issuer: 'https://hzy.wiztek.cn', tenant: 'C000001', environment: 'test', deployment: 'wiztek-test-console', now: Date.now(), maxAgeMs: 93600000 })
  if (body.expiresAt - body.issuedAt !== Number(lease)) throw Error('unexpected lease')
  stage = 'process isolation'
  const current = processes().filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
  if (JSON.stringify(current) !== JSON.stringify(others)) throw Error('unrelated process changed')
  const result = { switchedAt: new Date().toISOString(), target: name, leaseMs: Number(lease), pid: processes().find(p => p.name === name).pid,
    rollbackConfig: `${attempt}/rollback.config.json`, persisted: false, otherProcessesUnchanged: true }
  save(`${attempt}/receipt.json`, result)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  try { pm(['delete', name]) } catch {}
  pm(['start', `${attempt}/rollback.config.json`, '--only', name])
  console.error(`Lease switch failed at ${stage}; previous process restored: ${error.message}`)
  process.exitCode = 1
}
