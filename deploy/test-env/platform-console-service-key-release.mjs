// One-off, pinned C000001/test Platform dev release for R1 Console steady service
// identity (service key registration + serviceKeys in the signed envelope) and
// the R2/R3 renewal-state type change. Additive migration console_service_keys.
// Run on gitlab.wiztek.cn only: prepare -> check -> cutover -> persist.
// Reads existing process credentials in memory; never logs or copies them.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const baseRoot = '/wiztek/hzy-test/platform-candidates/policy-renewal-20260922'
const baseCwd = `${baseRoot}/platform`
const root = '/wiztek/hzy-test/platform-candidates/console-service-key-20260923'
const cwd = `${root}/platform`
const name = 'hzy-platform-dev'
const baseEntryHash = '6d6cbddb2bdba10fa3f493b7b65455fabe5dbe7a2449f808e566b14d24dae5a7'
// [before on the live base candidate (null: new file), after in this release]
const files = {
  'packages/authz-core/src/policy-envelope.ts': ['075f05891da4e8f6c856387def642aa7e8861b5fe881eeaae4aae22122912efd', '60362f789e3377b28393523f172c1224c99ff470ae97f8d99c0c28a7e9d38a28'],
  'server/utils/policyEnvelopeDelivery.ts': ['04c483eb8750052d8d11bfa0a203d49d2078bde0b5d0ee31809dd1219c4b409c', '604a33ea119f76e7914bd92f03b6cdd781200b1cf986acd0895b29f2d052214e'],
  'server/utils/currentPolicyEnvelope.ts': ['0f5354f34a16294a2587857ff6833332af1205190d6b8d4ee694f8236c0362ba', 'ac2880a192a48719ca3ccd728457524143948c768883e46193deb5b7ee884b25'],
  'server/utils/consoleServiceKeys.ts': [null, '9f276f887f0bd7da2efb3f98669138d68383199fa50fc4bc2ba5960dc13d7484'],
  'server/api/platform/internal/console/tenants/[tenantCode]/service-keys.post.ts': [null, '2a2cd1e9d5353636b2691e4b26167cf1b0ffdc5a821d3a227a716c60fb3bd4fd'],
  'test/consoleServiceKeys.test.ts': [null, '185ce9f21a0c61ec1a1372ed25ee4a6a05c99750e2d911172df5ed4378d86f15']
}
const migration = 'docs/sql/migrations/20260923-console-service-keys.sql'
const migrationHash = 'fb4170fb195c014d759284580da2dc6d297a0d5ef12ca2461358c84ac02dbfe1'
const TEST_LEASE_MS = 93600000
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const artifactHash = () => {
  const output = `${cwd}/.output`
  const list = fs.readdirSync(output, { recursive: true, withFileTypes: true })
    .filter(file => file.isFile()).map(file => path.relative(output, path.join(file.parentPath, file.name))).sort()
  return createHash('sha256').update(JSON.stringify(list.map(file => [file, hash(`${output}/${file}`)]))).digest('hex')
}
const pm = args => execFileSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const processes = () => JSON.parse(pm(['jlist']))
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
const mode = process.argv[2]
if (!['prepare', 'check', 'cutover', 'persist'].includes(mode)) throw Error('mode must be prepare, check, cutover or persist')
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const all = processes()
const live = all.find(p => p.name === name)
const liveCwd = mode === 'persist' ? cwd : baseCwd
if (!live?.pid || live.pm2_env.pm_cwd !== liveCwd || live.pm2_env.pm_exec_path !== `${liveCwd}/.output/server/index.mjs`
  || live.pm2_env.exec_mode !== 'fork_mode' || live.pm2_env.watch !== false) throw Error('running baseline mismatch')
if (mode !== 'persist' && hash(live.pm2_env.pm_exec_path) !== baseEntryHash) throw Error('running artifact mismatch')
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011' || env.HZY_PLATFORM_POLICY_ENVELOPE_ISSUER !== 'https://hzy.wiztek.cn'
  || env.HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS !== String(TEST_LEASE_MS)) throw Error('runtime binding mismatch')
const others = all.filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
const assertOthers = () => {
  const current = processes().filter(p => p.name !== name).map(p => [p.name, p.pid, p.pm2_env.status])
  if (JSON.stringify(current) !== JSON.stringify(others)) throw Error('unrelated process changed')
}

if (mode === 'prepare') {
  // Input uploaded beforehand to `${root}/input/platform/<file>`; nothing else.
  const input = `${root}/input/platform`
  if (fs.existsSync(cwd)) throw Error('candidate already exists')
  for (const [file, [before, after]] of Object.entries(files)) {
    if (before === null ? fs.existsSync(`${baseCwd}/${file}`) : hash(`${baseCwd}/${file}`) !== before) throw Error(`base mismatch: ${file}`)
    if (hash(`${input}/${file}`) !== after) throw Error(`input mismatch: ${file}`)
  }
  if (hash(`${input}/${migration}`) !== migrationHash) throw Error('input mismatch: migration')
  fs.mkdirSync(cwd)
  // Copy only source/build inputs; no dotenv, generated output, logs or secrets.
  for (const entry of ['app', 'server', 'packages', 'public', 'test', 'nuxt.config.ts', 'package.json', 'tsconfig.json', 'eslint.config.mjs', 'app.manifest.json']) {
    if (!fs.existsSync(`${baseCwd}/${entry}`)) continue
    fs.cpSync(`${baseCwd}/${entry}`, `${cwd}/${entry}`, { recursive: true,
      filter: source => !['node_modules', '.nuxt', '.output'].includes(path.basename(source)) && !path.basename(source).startsWith('.env') })
  }
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) fs.copyFileSync(`${baseRoot}/${file}`, `${root}/${file}`)
  // Reuse the unchanged installed dependency store; no install or upgrade.
  fs.symlinkSync(fs.realpathSync(`${baseRoot}/node_modules`), `${root}/node_modules`)
  fs.cpSync(`${baseCwd}/node_modules`, `${cwd}/node_modules`, { recursive: true, verbatimSymlinks: true })
  for (const file of Object.keys(files)) {
    fs.mkdirSync(path.dirname(`${cwd}/${file}`), { recursive: true })
    fs.copyFileSync(`${input}/${file}`, `${cwd}/${file}`)
  }
  fs.mkdirSync(path.dirname(`${root}/${migration}`), { recursive: true })
  fs.copyFileSync(`${input}/${migration}`, `${root}/${migration}`)
  save(`${root}/source-receipt.json`, { createdAt: new Date().toISOString(), baseEntry: live.pm2_env.pm_exec_path, baseEntryHash, files })
  assertOthers()
  console.log('Prepared isolated Platform source delta; no process changed.')
} else if (mode === 'check') {
  if (Object.entries(files).some(([file, [, after]]) => hash(`${cwd}/${file}`) !== after)) throw Error('candidate source mismatch')
  // No runtime credentials enter the build environment or generated artifact.
  const buildEnv = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
    NODE_ENV: 'production', HZY_DEPLOYMENT_PROFILE: 'platform-self-hosted-db',
    PLATFORM_AUTH_DEV_MOCK: 'false', NODE_OPTIONS: '--max-old-space-size=4096' }
  const bin = (tool, args) => execFileSync(`${cwd}/node_modules/.bin/${tool}`, args, { cwd, env: buildEnv, stdio: 'inherit' })
  bin('nuxt', ['prepare', '--dotenv', '/dev/null'])
  bin('eslint', Object.keys(files).filter(file => file.endsWith('.ts')))
  bin('nuxt', ['typecheck', '--dotenv', '/dev/null'])
  execFileSync(process.execPath, ['--test', '--experimental-strip-types', 'test/policyEnvelope.test.ts', 'test/policyEnvelopeDelivery.test.ts', 'test/consoleServiceKeys.test.ts'], { cwd, env: buildEnv, stdio: 'inherit' })
  bin('nuxt', ['build', '--preset=node-server', '--dotenv', '/dev/null'])
  assertOthers()
  save(`${root}/checks.json`, { checkedAt: new Date().toISOString(), node: process.version,
    artifactHash: artifactHash(), entryHash: hash(`${cwd}/.output/server/index.mjs`),
    checks: ['scoped lint', 'typecheck', 'policy envelope and service key tests', 'node build'] })
  console.log('Checks passed; no process changed.')
} else if (mode === 'persist') {
  const receipt = JSON.parse(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
  if (live.pid !== receipt.pid || live.pm2_env.pm_exec_path !== receipt.candidateEntry) throw Error('live deployment mismatch')
  const dumpPath = '/root/.pm2/dump.pm2'
  const before = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  if (before.filter(p => p.name === name).length !== 1 || before.find(p => p.name === name).pm_exec_path !== receipt.previousEntry) {
    throw Error('saved baseline mismatch')
  }
  const replacement = { ...live.pm2_env }
  delete replacement.pm_id
  const after = before.map(p => p.name === name ? replacement : p)
  const other = entries => JSON.stringify(entries.filter(p => p.name !== name))
  if (other(before) !== other(after)) throw Error('unrelated saved process changed')
  save(`${root}/protected-previous-dump.json`, before)
  const temporary = `${dumpPath}.console-service-key-20260923.tmp`
  save(temporary, after)
  fs.renameSync(temporary, dumpPath)
  const stored = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  if (other(stored) !== other(before) || stored.find(p => p.name === name)?.pm_exec_path !== receipt.candidateEntry) {
    throw Error('saved configuration verification failed')
  }
  assertOthers()
  save(`${root}/persistence-receipt.json`, { savedAt: new Date().toISOString(), target: name,
    entry: receipt.candidateEntry, previousEntry: receipt.previousEntry, otherProcessesUnchanged: true })
  console.log('Verified Platform dev PM2 persistence for target only.')
} else {
  const checks = JSON.parse(fs.readFileSync(`${root}/checks.json`, 'utf8'))
  const candidateEntry = `${cwd}/.output/server/index.mjs`
  if (hash(candidateEntry) !== checks.entryHash || artifactHash() !== checks.artifactHash
    || Object.entries(files).some(([file, [, after]]) => hash(`${cwd}/${file}`) !== after)
    || hash(`${root}/${migration}`) !== migrationHash) throw Error('artifact mismatch')
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key)
    && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(key)))
  const settings = Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay',
    'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format',
    'node_args', 'args', 'shutdown_with_message', 'treekill', 'autorestart']
    .filter(key => live.pm2_env[key] !== undefined).map(key => [key, live.pm2_env[key]]))
  const app = { ...settings, name, cwd: baseCwd, script: live.pm2_env.pm_exec_path,
    interpreter: live.pm2_env.exec_interpreter, out_file: live.pm2_env.pm_out_log_path,
    error_file: live.pm2_env.pm_err_log_path, exec_mode: 'fork', instances: 1, watch: false, env: cleanEnv }
  const attempt = fs.mkdtempSync(`${root}/attempt-`)
  const rollback = `${attempt}/rollback.config.json`
  save(rollback, { apps: [app] })
  // Same environment, including the pinned C000001 test lease.
  save(`${attempt}/candidate.config.json`, { apps: [{ ...app, cwd, script: candidateEntry }] })
  const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim()
    || env.PLATFORM_INTERNAL_SERVICE_TOKEN
  if (!token) throw Error('existing service credential missing')
  const require = createRequire(`${baseCwd}/package.json`)
  const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
  let signingKey, factsBefore
  const facts = async () => {
    const [rows] = await connection.query("SELECT id,bundle_version,bundle_hash,policy_revision,status,expires_at FROM policy_bundles WHERE tenant_code='C000001' ORDER BY id")
    const [revision] = await connection.query("SELECT policy_revision,policy_hash FROM tenant_policy_revisions WHERE tenant_code='C000001'")
    return createHash('sha256').update(JSON.stringify([rows, revision])).digest('hex')
  }
  const [keys] = await connection.query("SELECT kid, public_key FROM platform_signing_keys WHERE status='active' AND alg='Ed25519' ORDER BY activated_at DESC,id DESC LIMIT 1")
  signingKey = keys[0]
  if (!signingKey) throw Error('active signing key missing')
  factsBefore = await facts()
  const keyRows = async () => {
    const [rows] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='console_service_keys'")
    if (Number(rows[0].count) !== 1) return null
    const [keys] = await connection.query('SELECT COUNT(*) AS count FROM console_service_keys')
    return Number(keys[0].count)
  }
  const base = '/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console'
  const request = (target, authenticated = false) => fetch(`http://127.0.0.1:3011${target}`, {
    redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: authenticated ? { authorization: `Bearer ${token}` } : {}
  })
  let stage = 'baseline'
  try {
    const anonymousBefore = await request(`${base}&format=hzy-policy-envelope.v1`)
    if (![401, 403].includes(anonymousBefore.status)) throw Error('baseline auth missing')
    const deniedStatus = anonymousBefore.status
    await anonymousBefore.body?.cancel()
    stage = 'migration'
    // Additive: CREATE TABLE IF NOT EXISTS; the running base ignores the table.
    await connection.query(fs.readFileSync(`${root}/${migration}`, 'utf8'))
    const keysBefore = await keyRows()
    if (keysBefore === null) throw Error('console_service_keys missing after migration')
    stage = 'cutover'
    pm(['delete', name])
    pm(['start', `${attempt}/candidate.config.json`, '--only', name])
    let healthy = false
    for (let index = 0; index < 30 && !healthy; index++) {
      try {
        const response = await request('/api/health')
        healthy = response.status === 200
        await response.body?.cancel()
      } catch {}
      if (!healthy) await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!healthy) throw Error('candidate health failed')
    stage = 'authentication'
    for (const format of ['hzy-policy-envelope.v1', 'hzy-policy-revision.v1']) {
      const anonymous = await request(`${base}&format=${format}`)
      if (anonymous.status !== deniedStatus) throw Error(`authentication contract changed: ${format}`)
      await anonymous.body?.cancel()
    }
    stage = 'signed envelope'
    const response = await request(`${base}&format=hzy-policy-envelope.v1`, true)
    if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw Error('fresh delivery failed')
    const { verifyPolicyEnvelope } = await import(pathToFileURL(`${cwd}/packages/authz-core/src/policy-envelope.ts`))
    const policy = verifyPolicyEnvelope((await response.json()).data, { kid: signingKey.kid, publicKey: signingKey.public_key },
      { issuer: 'https://hzy.wiztek.cn', tenant: 'C000001', environment: 'test', deployment: 'wiztek-test-console', now: Date.now(), maxAgeMs: TEST_LEASE_MS })
    if (policy.expiresAt - policy.issuedAt !== TEST_LEASE_MS || policy.status !== 'active') throw Error('unexpected policy lease or status')
    stage = 'revision probe'
    const probeResponse = await request(`${base}&format=hzy-policy-revision.v1`, true)
    const probe = probeResponse.status === 200 ? (await probeResponse.json()).data : null
    if (!probe || probe.tenant !== 'C000001' || probe.policyRevision !== policy.policyRevision || probe.payloadHash !== policy.payloadHash
      || probe.status !== 'active' || probe.bundleVersion !== policy.bundleVersion || 'payload' in probe || 'signature' in probe) throw Error('revision probe mismatch')
    if ('serviceKeys' in policy && !policy.serviceKeys.every(key => key.deployment === 'wiztek-test-console')) throw Error('foreign service key signed')
    stage = 'service key endpoint'
    const keyPath = '/api/platform/internal/console/tenants/C000001/service-keys'
    const register = (body, authenticated = true) => fetch(`http://127.0.0.1:3011${keyPath}`, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(30000), body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) } })
    const validShape = { environment: 'test', deploymentCode: 'wiztek-test-console', publicKey: 'A'.repeat(43) }
    const anonymousKey = await register(validShape, false)
    if (anonymousKey.status !== deniedStatus) throw Error('service key authentication missing')
    await anonymousKey.body?.cancel()
    for (const body of [{ ...validShape, publicKey: 'short' }, { ...validShape, extra: true }]) {
      const invalid = await register(body)
      if (invalid.status !== 400) throw Error('service key validation missing')
      await invalid.body?.cancel()
    }
    const inactive = await register({ ...validShape, deploymentCode: 'hzy-renewal-missing-probe' })
    const inactiveBody = await inactive.json().catch(() => null)
    if (inactive.status !== 403 || inactiveBody?.data?.code !== 'policy_deployment_inactive') throw Error('inactive deployment accepted')
    if (await keyRows() !== keysBefore) throw Error('service key rows changed by contract probes')
    stage = 'refusal code'
    const missing = await request('/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=hzy-renewal-missing-probe&format=hzy-policy-revision.v1', true)
    const missingBody = await missing.json().catch(() => null)
    if (missing.status !== 409 || missingBody?.data?.code !== 'policy_envelope_current_missing') throw Error('refusal code missing')
    stage = 'historical format rejection'
    const oldFormat = await request(`${base}&format=hzy-policy-envelope.v1&version=no-generation`, true)
    if (oldFormat.status !== 400) throw Error('historical format guard changed')
    await oldFormat.body?.cancel()
    stage = 'no policy writes'
    if (await facts() !== factsBefore) throw Error('policy rows changed')
    stage = 'process isolation'
    assertOthers()
    const active = processes().find(p => p.name === name)
    if (active?.pm2_env.pm_exec_path !== candidateEntry || hash(candidateEntry) !== checks.entryHash) throw Error('candidate artifact mismatch')
    save(`${root}/deployment-receipt.json`, { deployedAt: new Date().toISOString(), target: name,
      candidateEntry, candidateHash: checks.entryHash, artifactHash: checks.artifactHash,
      sourceHashes: Object.fromEntries(Object.entries(files).map(([file, [, after]]) => [file, after])),
      previousEntry: app.script, previousHash: baseEntryHash, rollbackConfig: rollback, pid: active.pid,
      bundleVersion: policy.bundleVersion, policyRevision: policy.policyRevision, lifetimeMs: policy.expiresAt - policy.issuedAt,
      health: 200, anonymous: deniedStatus, revisionProbe: 200, missingDeploymentRefusal: 409, historicalFormat: 400,
      migration: { file: migration, sha256: migrationHash, tablePresent: true }, serviceKeysSigned: policy.serviceKeys?.length ?? 0,
      serviceKeyEndpoint: { anonymous: deniedStatus, invalid: 400, inactiveDeployment: 403, rowsUnchanged: true },
      policyRowsUnchanged: true, otherProcessesUnchanged: true })
    console.log(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
  } catch (error) {
    try { pm(['delete', name]) } catch {}
    pm(['start', rollback, '--only', name])
    // The additive console_service_keys table is intentionally kept on rollback.
    console.error(`Cutover failed at ${stage}; original process restored: ${error.message}`)
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}
