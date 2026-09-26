// One-off, pinned C000001/test Platform dev cutover. Run on gitlab.wiztek.cn.
// Reads existing process credentials in memory; never logs or copies them.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = '/wiztek/hzy-test/platform-candidates/policy-lease-20260922'
const cwd = `${root}/platform`
const previousCwd = '/wiztek/hzy-test/platform-candidates/policy-envelope-20260921/platform'
const name = 'hzy-platform-dev'
const sourceHashes = {
  'server/utils/currentPolicyEnvelope.ts': 'b41141dac75a0002095e3dce22584a53803d48bf141854318e2e82a9e4b404c6',
  'server/utils/policyEnvelopeDelivery.ts': '6fb547ae2f0326af3f09105215407d193d0bb1da991d9e04e7a0011890475c94',
  'test/policyEnvelopeDelivery.test.ts': '9972a592ac70b038133cf33a453ae359999f04687f227218b18be841bba35a4a'
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pm = args => execFileSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const processes = () => JSON.parse(pm(['jlist']))
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
if (Object.entries(sourceHashes).some(([file, digest]) => hash(`${cwd}/${file}`) !== digest)) throw Error('source mismatch')
const candidateEntry = `${cwd}/.output/server/index.mjs`
const candidateHash = hash(candidateEntry)
const all = processes()
const live = all.find(p => p.name === name)
if (!live?.pid || live.pm2_env.pm_cwd !== previousCwd || live.pm2_env.pm_exec_path !== `${previousCwd}/.output/server/index.mjs`
  || live.pm2_env.exec_mode !== 'fork_mode' || live.pm2_env.watch !== false) throw Error('running baseline mismatch')
const previousHash = hash(live.pm2_env.pm_exec_path)
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011' || env.HZY_PLATFORM_POLICY_ENVELOPE_ISSUER !== 'https://hzy.wiztek.cn') {
  throw Error('runtime binding mismatch')
}
const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key)
  && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(key)))
const settings = Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay',
  'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format',
  'node_args', 'args', 'shutdown_with_message', 'treekill', 'autorestart']
  .filter(key => live.pm2_env[key] !== undefined).map(key => [key, live.pm2_env[key]]))
const app = { ...settings, name, cwd: previousCwd, script: live.pm2_env.pm_exec_path,
  interpreter: live.pm2_env.exec_interpreter, out_file: live.pm2_env.pm_out_log_path,
  error_file: live.pm2_env.pm_err_log_path, exec_mode: 'fork', instances: 1, watch: false, env: cleanEnv }
const attempt = fs.mkdtempSync(`${root}/attempt-`)
const rollback = `${attempt}/rollback.config.json`
save(rollback, { apps: [app] })
save(`${attempt}/candidate.config.json`, { apps: [{ ...app, cwd, script: candidateEntry,
  env: { ...cleanEnv, HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS: '93600000' } }] })
const others = all.filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
const assertOthers = () => {
  const current = processes().filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
  if (JSON.stringify(current) !== JSON.stringify(others)) throw Error('unrelated process changed')
}
const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim()
  || env.PLATFORM_INTERNAL_SERVICE_TOKEN
if (!token) throw Error('existing service credential missing')
const require = createRequire(`${previousCwd}/package.json`)
const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
let signingKey
try {
  const [rows] = await connection.query("SELECT kid, public_key FROM platform_signing_keys WHERE status='active' AND alg='Ed25519' ORDER BY activated_at DESC,id DESC LIMIT 1")
  signingKey = rows[0]
  if (!signingKey) throw Error('active signing key missing')
} finally { await connection.end() }
const endpoint = '/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console&format=hzy-policy-envelope.v1'
const request = (path, authenticated = false) => fetch(`http://127.0.0.1:3011${path}`, {
  redirect: 'error', signal: AbortSignal.timeout(90000),
  headers: authenticated ? { authorization: `Bearer ${token}` } : {}
})
let stage = 'baseline'
try {
  const anonymousBefore = await request(endpoint)
  if (![401, 403].includes(anonymousBefore.status)) throw Error('baseline auth missing')
  const deniedStatus = anonymousBefore.status
  await anonymousBefore.body?.cancel()
  stage = 'cutover'
  pm(['delete', name])
  pm(['start', `${attempt}/candidate.config.json`, '--only', name])
  let healthy = false
  for (let index = 0; index < 30; index++) {
    try {
      const response = await request('/api/health')
      healthy = response.status === 200
      await response.body?.cancel()
      if (healthy) break
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!healthy) throw Error('candidate health failed')
  stage = 'authentication'
  const anonymous = await request(endpoint)
  if (anonymous.status !== deniedStatus) throw Error('authentication contract changed')
  await anonymous.body?.cancel()
  stage = 'signed envelope'
  const response = await request(endpoint, true)
  if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw Error('fresh delivery failed')
  const envelope = (await response.json()).data
  const { verifyPolicyEnvelope } = await import(pathToFileURL(`${cwd}/packages/authz-core/src/policy-envelope.ts`))
  const policy = verifyPolicyEnvelope(envelope, { kid: signingKey.kid, publicKey: signingKey.public_key },
  { issuer: 'https://hzy.wiztek.cn', tenant: 'C000001', environment: 'test', deployment: 'wiztek-test-console', now: Date.now(), maxAgeMs: 93600000 })
  if (policy.expiresAt - policy.issuedAt !== 93600000) throw Error('unexpected policy lease')
  stage = 'historical format rejection'
  const oldFormat = await request(`${endpoint}&version=no-generation`, true)
  if (oldFormat.status !== 400) throw Error('historical format guard changed')
  await oldFormat.body?.cancel()
  stage = 'process isolation'
  assertOthers()
  const active = processes().find(p => p.name === name)
  if (active?.pm2_env.pm_exec_path !== candidateEntry || hash(candidateEntry) !== candidateHash) throw Error('candidate artifact mismatch')
  save(`${root}/deployment-receipt.json`, { deployedAt: new Date().toISOString(), target: name,
    candidateEntry, candidateHash, sourceHashes, previousEntry: app.script, previousHash,
    rollbackConfig: rollback, pid: active.pid, bundleVersion: policy.bundleVersion,
    policyRevision: policy.policyRevision, lifetimeMS: policy.expiresAt - policy.issuedAt,
    health: 200, anonymous: deniedStatus, historicalFormat: 400, otherProcessesUnchanged: true })
  console.log(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
} catch (error) {
  try { pm(['delete', name]) } catch {}
  pm(['start', rollback, '--only', name])
  console.error(`Cutover failed at ${stage}; original process restored: ${error.message}`)
  process.exitCode = 1
}
