// Pinned, one-off development Platform release. Run on gitlab.wiztek.cn only.
// Never deploy the whole workspace or export credentials from this server.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const oldRoot = '/wiztek/hzy-test/platform-candidates/review-ui-paste-158c9b41'
const root = '/wiztek/hzy-test/platform-candidates/policy-envelope-20260921'
const cwd = `${root}/platform`
const name = 'hzy-platform-dev'
const oldEntryHash = 'eda69251613de61c0928bd181e61b2c9c087da2a3d9d55070b9aa8507cc9d00b'
const changed = ['nuxt.config.ts', 'packages/authz-core/package.json',
  'server/api/platform/internal/console/tenants/[tenantCode]/bundle.get.ts',
  'server/api/v1/runtime/deployments/[deploymentCode]/bundle.get.ts', 'server/utils/policyBundle.ts',
  'packages/authz-core/src/policy-envelope.ts', 'server/utils/currentPolicyEnvelope.ts',
  'server/utils/policyEnvelope.ts', 'server/utils/policyEnvelopeDelivery.ts',
  'test/policyEnvelope.test.ts', 'test/policyEnvelopeDelivery.test.ts']
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const artifactHash = () => {
  const output = `${cwd}/.output`
  const files = fs.readdirSync(output, { recursive: true, withFileTypes: true })
    .filter(file => file.isFile()).map(file => path.relative(output, path.join(file.parentPath, file.name))).sort()
  return createHash('sha256').update(JSON.stringify(files.map(file => [file, hash(`${output}/${file}`)]))).digest('hex')
}
const pm = args => execFileSync('pm2', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const processes = () => JSON.parse(pm(['jlist']))
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
const mode = process.argv[2]
if (!['prepare', 'check', 'cutover', 'persist'].includes(mode) || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('target mismatch')
const all = processes()
const live = all.find(p => p.name === name)
const expectedCwd = mode === 'persist' ? cwd : `${oldRoot}/platform`
const expectedHash = mode === 'persist' ? JSON.parse(fs.readFileSync(`${root}/checks.json`, 'utf8')).entryHash : oldEntryHash
if (!live?.pid || live.pm2_env.pm_cwd !== expectedCwd || hash(live.pm2_env.pm_exec_path) !== expectedHash
  || live.pm2_env.exec_mode !== 'fork_mode' || live.pm2_env.watch !== false) throw Error('baseline mismatch')
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011') throw Error('database/port mismatch')
const others = all.filter(p => p.name !== name).map(p => ({ name: p.name, pid: p.pid, status: p.pm2_env.status }))
const assertOthers = () => {
  const current = processes().filter(p => p.name !== name).map(p => ({ name: p.name, pid: p.pid, status: p.pm2_env.status }))
  if (JSON.stringify(current) !== JSON.stringify(others)) throw Error('unrelated process changed')
}

if (mode === 'prepare') {
  const input = `${root}/input`
  const manifest = JSON.parse(fs.readFileSync(`${input}/manifest.json`, 'utf8'))
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(changed.slice().sort())) throw Error('unexpected delta')
  if (fs.existsSync(cwd)) throw Error('candidate already exists')
  for (const file of changed) {
    const before = manifest.files[file].before
    if (before && hash(`${oldRoot}/platform/${file}`) !== before) throw Error(`source baseline mismatch: ${file}`)
    if (hash(`${input}/platform/${file}`) !== manifest.files[file].after) throw Error(`input mismatch: ${file}`)
  }
  fs.mkdirSync(cwd)
  // Copy only source/build inputs; no dotenv, generated output, logs or secrets.
  for (const file of ['app', 'server', 'packages', 'public', 'test', 'nuxt.config.ts', 'package.json', 'tsconfig.json', 'eslint.config.mjs', 'app.manifest.json']) {
    fs.cpSync(`${oldRoot}/platform/${file}`, `${cwd}/${file}`, { recursive: true,
      filter: source => !['node_modules', '.nuxt', '.output'].includes(path.basename(source)) && !path.basename(source).startsWith('.env') })
  }
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) fs.copyFileSync(`${oldRoot}/${file}`, `${root}/${file}`)
  fs.symlinkSync(`${oldRoot}/node_modules`, `${root}/node_modules`)
  // Keep workspace package links relative to the candidate, while external
  // dependency links still resolve through the unchanged root store.
  fs.cpSync(`${oldRoot}/platform/node_modules`, `${cwd}/node_modules`, { recursive: true, verbatimSymlinks: true })
  for (const file of changed) {
    fs.mkdirSync(path.dirname(`${cwd}/${file}`), { recursive: true })
    fs.copyFileSync(`${input}/platform/${file}`, `${cwd}/${file}`)
  }
  save(`${root}/source-receipt.json`, { createdAt: new Date().toISOString(), baselineEntry: live.pm2_env.pm_exec_path, baselineEntryHash: oldEntryHash, ...manifest })
  assertOthers()
  console.log('Prepared isolated Platform source delta; no process changed.')
} else if (mode === 'check') {
  // No runtime credentials enter the build environment or generated artifact.
  const buildEnv = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
    NODE_ENV: 'production', HZY_DEPLOYMENT_PROFILE: 'platform-self-hosted-db',
    PLATFORM_AUTH_DEV_MOCK: 'false', NODE_OPTIONS: '--max-old-space-size=4096' }
  // Invoke already installed binaries directly. pnpm 11 exec can auto-install
  // after package metadata changes; shared baseline dependencies must not change.
  const run = args => execFileSync(`${cwd}/node_modules/.bin/${args[1]}`, args.slice(2), { cwd, env: buildEnv, stdio: 'inherit' })
  run(['exec', 'nuxt', 'prepare', '--dotenv', '/dev/null'])
  run(['exec', 'eslint', ...changed.filter(f => f.endsWith('.ts'))])
  run(['exec', 'nuxt', 'typecheck', '--dotenv', '/dev/null'])
  execFileSync(process.execPath, ['--test', '--experimental-strip-types', 'test/policyEnvelope.test.ts', 'test/policyEnvelopeDelivery.test.ts'], { cwd, env: buildEnv, stdio: 'inherit' })
  run(['exec', 'nuxt', 'build', '--preset=node-server', '--dotenv', '/dev/null'])
  assertOthers()
  save(`${root}/checks.json`, { checkedAt: new Date().toISOString(), node: process.version,
    sourceHashes: Object.fromEntries(changed.map(file => [file, hash(`${cwd}/${file}`)])),
    artifactHash: artifactHash(), entryHash: hash(`${cwd}/.output/server/index.mjs`), checks: ['scoped lint', 'typecheck', 'policy envelope tests', 'node build'] })
} else if (mode === 'persist') {
  const receipt = JSON.parse(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
  if (receipt.pid !== live.pid || env.HZY_PLATFORM_POLICY_ENVELOPE_ISSUER !== receipt.issuer) throw Error('unverified live process')
  const dumpPath = '/root/.pm2/dump.pm2'
  const before = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  const selected = before.filter(p => p.name === name)
  if (selected.length !== 1) throw Error('unexpected saved process inventory')
  save(`${root}/protected-previous-dump.json`, before)
  const replacement = { ...live.pm2_env }
  delete replacement.pm_id
  const next = before.map(p => p.name === name ? replacement : p)
  const otherSaved = rows => JSON.stringify(rows.filter(p => p.name !== name))
  if (otherSaved(before) !== otherSaved(next)) throw Error('unrelated saved configuration changed')
  const temp = `${dumpPath}.policy-envelope-20260921.tmp`
  save(temp, next)
  fs.renameSync(temp, dumpPath)
  const actual = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
  if (otherSaved(before) !== otherSaved(actual) || actual.find(p => p.name === name)?.pm_exec_path !== receipt.entry) throw Error('persistence verification failed')
  assertOthers()
  const savedReceipt = { savedAt: new Date().toISOString(), name, entry: receipt.entry,
    previousSavedEntry: selected[0].pm_exec_path, onlyTargetEntryChanged: true, otherProcessesUnchanged: true }
  save(`${root}/persistence-receipt.json`, savedReceipt)
  console.log(JSON.stringify(savedReceipt, null, 2))
} else {
  const checks = JSON.parse(fs.readFileSync(`${root}/checks.json`, 'utf8'))
  if (hash(`${cwd}/.output/server/index.mjs`) !== checks.entryHash || artifactHash() !== checks.artifactHash
    || changed.some(file => hash(`${cwd}/${file}`) !== checks.sourceHashes[file])) throw Error('artifact mismatch')
  const require = createRequire(`${oldRoot}/platform/package.json`)
  const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
  const facts = async () => {
    const [rows] = await connection.query("SELECT id,bundle_version,bundle_hash,policy_revision,status,expires_at FROM policy_bundles WHERE tenant_code='C000001' AND environment='test' ORDER BY id")
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  await connection.query('START TRANSACTION READ ONLY')
  const beforeFacts = await facts()
  const [keys] = await connection.query("SELECT kid,public_key,private_key_ref FROM platform_signing_keys WHERE status='active' AND alg='Ed25519' ORDER BY activated_at DESC,id DESC LIMIT 1")
  if (!keys[0]) throw Error('no existing signing authority')
  // Prove the existing key is usable before calling a legacy signer that can
  // otherwise try to repair its key registration. Material never leaves RAM.
  const reference = keys[0].private_key_ref
  const rawMaterial = (reference.startsWith('env:') ? env[reference.slice(4)] : reference)?.trim()
  const material = rawMaterial?.startsWith('base64:') ? Buffer.from(rawMaterial.slice(7), 'base64').toString('utf8').trim() : rawMaterial
  if (!material || (!material.includes('PRIVATE KEY') && !material.startsWith('/') && !material.startsWith('file:'))) throw Error('unsupported signing reference')
  const pem = material.includes('PRIVATE KEY') ? material.replace(/\\n/g, '\n') : fs.readFileSync(material.startsWith('file:') ? new URL(material) : material, 'utf8')
  const publicDER = value => createPublicKey(value).export({ type: 'spki', format: 'der' })
  if (!publicDER(createPrivateKey(pem)).equals(publicDER(keys[0].public_key))) throw Error('existing signing authority mismatch')
  await connection.rollback()
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key) && !/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(key)))
  const settings = Object.fromEntries(['kill_timeout', 'listen_timeout', 'min_uptime', 'max_restarts', 'restart_delay',
    'exp_backoff_restart_delay', 'max_memory_restart', 'cron_restart', 'merge_logs', 'time', 'log_date_format',
    'node_args', 'args', 'shutdown_with_message', 'treekill', 'autorestart'].filter(key => live.pm2_env[key] !== undefined).map(key => [key, live.pm2_env[key]]))
  const app = { ...settings, name, cwd: live.pm2_env.pm_cwd, script: live.pm2_env.pm_exec_path, interpreter: live.pm2_env.exec_interpreter,
    out_file: live.pm2_env.pm_out_log_path, error_file: live.pm2_env.pm_err_log_path,
    exec_mode: 'fork', instances: 1, watch: false, env: cleanEnv }
  const attempt = fs.mkdtempSync(`${root}/attempt-`)
  save(`${attempt}/protected-previous-pm2.json`, live)
  save(`${attempt}/rollback.config.json`, { apps: [app] })
  save(`${attempt}/candidate.config.json`, { apps: [{ ...app, cwd, script: `${cwd}/.output/server/index.mjs`,
    env: { ...cleanEnv, HZY_PLATFORM_POLICY_ENVELOPE_ISSUER: 'https://hzy.wiztek.cn' } }] })
  const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim() || env.PLATFORM_INTERNAL_SERVICE_TOKEN
  if (!token) throw Error('existing service credential missing')
  const { verifyPolicyEnvelope } = await import(pathToFileURL(`${cwd}/packages/authz-core/src/policy-envelope.ts`))
  const request = (url, authenticated = false, timeout = 10000) => fetch(`http://127.0.0.1:3011${url}`, { redirect: 'error', signal: AbortSignal.timeout(timeout), headers: authenticated ? { authorization: `Bearer ${token}` } : {} })
  const endpoint = '/api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console'
  const baselineDenial = await request(`${endpoint}&format=hzy-policy-envelope.v1&version=no-generation`)
  const deniedStatus = baselineDenial.status
  await baselineDenial.body?.cancel()
  // The existing internal-service middleware uses 403 for a missing token.
  // Preserve that contract; do not silently alter authentication in this release.
  if (![401, 403].includes(deniedStatus)) throw Error('baseline authentication not enforced')
  let stage = 'start'
  try {
    pm(['delete', name])
    pm(['start', `${attempt}/candidate.config.json`, '--only', name])
    let ready = false
    for (let attempt = 0; attempt < 20; attempt++) {
      try { const r = await request('/api/health'); ready = r.status === 200; await r.body?.cancel() } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!ready) throw Error('candidate health failed')
    stage = 'history guard'
    const guarded = await request(`${endpoint}&format=hzy-policy-envelope.v1&version=no-generation`, true)
    if (guarded.status !== 400) throw Error('format guard failed')
    await guarded.body?.cancel()
    stage = 'anonymous rejection'
    const anonymous = await request(`${endpoint}&format=hzy-policy-envelope.v1`)
    if (anonymous.status !== deniedStatus) throw Error('authentication failed closed check failed')
    await anonymous.body?.cancel()
    stage = 'fresh envelope'
    const response = await request(`${endpoint}&format=hzy-policy-envelope.v1`, true)
    if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw Error('fresh delivery failed')
    const envelope = (await response.json()).data
    stage = 'signature and deployment bindings'
    const context = { issuer: 'https://hzy.wiztek.cn', tenant: 'C000001', environment: 'test', now: Date.now() }
    const key = { kid: keys[0].kid, publicKey: keys[0].public_key }
    const policy = verifyPolicyEnvelope(envelope, key, { ...context, deployment: 'wiztek-test-console' })
    verifyPolicyEnvelope(envelope, key, { ...context, deployment: 'C000001-test-enterprise' })
    stage = 'legacy format'
    // The unchanged legacy path was measured at 17–37 seconds in isolated
    // baseline/candidate probes. This is a test budget, not a runtime change.
    const legacy = await request(`${endpoint}&version=${encodeURIComponent(policy.bundleVersion)}`, true, 60000)
    if (legacy.status !== 200) throw Error('legacy compatibility failed')
    await legacy.body?.cancel()
    stage = 'unchanged data and processes'
    if (beforeFacts !== await facts()) throw Error('policy rows changed')
    assertOthers()
    const active = processes().find(p => p.name === name)
    if (active.pm2_env.pm_cwd !== cwd || active.pm2_env.pm_exec_path !== `${cwd}/.output/server/index.mjs`) throw Error('active artifact mismatch')
    save(`${root}/deployment-receipt.json`, { deployedAt: new Date().toISOString(), target: name, database: env.DB_NAME,
      entry: active.pm2_env.pm_exec_path, entryHash: checks.entryHash, artifactHash: checks.artifactHash, issuer: context.issuer, pid: active.pid,
      rollbackEntry: app.script, rollbackConfig: `${attempt}/rollback.config.json`, rollbackEntryHash: oldEntryHash, otherProcessesUnchanged: true, policyRowsUnchanged: true,
      health: 200, unauthenticated: deniedStatus, baselineUnauthenticated: deniedStatus, historicalFormat: 400, legacy: 200, fresh: 200, noStore: true,
      kid: envelope.kid, bundleVersion: policy.bundleVersion, policyRevision: policy.policyRevision,
      lifetimeMS: policy.expiresAt - policy.issuedAt, consoleAndEnterpriseVerified: true })
    console.log(fs.readFileSync(`${root}/deployment-receipt.json`, 'utf8'))
  } catch {
    try { pm(['delete', name]) } catch {}
    pm(['start', `${attempt}/rollback.config.json`, '--only', name])
    console.error(`Candidate verification failed at ${stage}; original development process restored.`)
    process.exitCode = 1
  } finally { await connection.end() }
}
