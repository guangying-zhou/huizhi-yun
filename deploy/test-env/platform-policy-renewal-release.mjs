// One-off, pinned C000001/test Platform dev release for the policy outage-grace
// plan stage C (revision probe, signed tenant lifecycle, refusal codes).
// Run on gitlab.wiztek.cn only: prepare -> check -> cutover -> persist.
// Reads existing process credentials in memory; never logs or copies them.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const baseRoot = '/wiztek/hzy-test/platform-candidates/policy-lease-20260922'
const baseCwd = `${baseRoot}/platform`
const root = '/wiztek/hzy-test/platform-candidates/policy-renewal-20260922'
const cwd = `${root}/platform`
const name = 'hzy-platform-dev'
const baseEntryHash = '2844da3f3cce8ab1d400f6dfc8b0cf39649b299e107d3a1086010b0c5de2200c'
// [before on the live base candidate, after in this release]
const files = {
  'server/utils/policyEnvelopeDelivery.ts': ['6fb547ae2f0326af3f09105215407d193d0bb1da991d9e04e7a0011890475c94', '04c483eb8750052d8d11bfa0a203d49d2078bde0b5d0ee31809dd1219c4b409c'],
  'server/utils/currentPolicyEnvelope.ts': ['b41141dac75a0002095e3dce22584a53803d48bf141854318e2e82a9e4b404c6', '0f5354f34a16294a2587857ff6833332af1205190d6b8d4ee694f8236c0362ba'],
  'server/utils/policyBundle.ts': ['5f834f6889057cb20f4102877da07f08d6ee8db92bf98d63dc330cac05110961', '2af8a335543f03904d731504972aa962434dd3f6c443d1ac51a172f3fdbd17e0'],
  'server/api/platform/internal/console/tenants/[tenantCode]/bundle.get.ts': ['8169eac4a4d4c75bd9ce012130ab64737e286146022fef061d1ad082f0548078', '89a6a25d7cfbdc6bf36775be82d3e96eed6df84b469a5c8c1528d328bfedd250'],
  'server/api/v1/runtime/deployments/[deploymentCode]/bundle.get.ts': ['21b2e9ebaecd9519812e6014a3601527f17ef477f1172a8cb54160ce47e1b1de', 'd645446fd9ba1cab4c7395cc4cefc9bcdf42dc3202f99cd8262d9167d2bf4545'],
  'packages/authz-core/src/policy-envelope.ts': ['86e8eaf79ffc4afa59ef1e19bd914afba97fe18435e515e6e660776e7b270121', '075f05891da4e8f6c856387def642aa7e8861b5fe881eeaae4aae22122912efd'],
  'test/policyEnvelopeDelivery.test.ts': ['9972a592ac70b038133cf33a453ae359999f04687f227218b18be841bba35a4a', '58c9fb6ebb8e50ac6a9b382a0cc091a6a3c258125518b982aa92787f421ed4b7']
}
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
    if (hash(`${baseCwd}/${file}`) !== before) throw Error(`base mismatch: ${file}`)
    if (hash(`${input}/${file}`) !== after) throw Error(`input mismatch: ${file}`)
  }
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
  for (const file of Object.keys(files)) fs.copyFileSync(`${input}/${file}`, `${cwd}/${file}`)
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
  execFileSync(process.execPath, ['--test', '--experimental-strip-types', 'test/policyEnvelope.test.ts', 'test/policyEnvelopeDelivery.test.ts'], { cwd, env: buildEnv, stdio: 'inherit' })
  bin('nuxt', ['build', '--preset=node-server', '--dotenv', '/dev/null'])
  assertOthers()
  save(`${root}/checks.json`, { checkedAt: new Date().toISOString(), node: process.version,
    artifactHash: artifactHash(), entryHash: hash(`${cwd}/.output/server/index.mjs`),
    checks: ['scoped lint', 'typecheck', 'policy envelope tests', 'node build'] })
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
  const temporary = `${dumpPath}.policy-renewal-20260922.tmp`
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
    || Object.entries(files).some(([file, [, after]]) => hash(`${cwd}/${file}`) !== after)) throw Error('artifact mismatch')
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
  // Same environment; the general lease variable stays unset (five-minute default).
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
      policyRowsUnchanged: true, otherProcessesUnchanged: true })
    console.log(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
  } catch (error) {
    try { pm(['delete', name]) } catch {}
    pm(['start', rollback, '--only', name])
    console.error(`Cutover failed at ${stage}; original process restored: ${error.message}`)
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}
