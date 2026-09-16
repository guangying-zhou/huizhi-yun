#!/usr/bin/env node
// One-time domestic enrollment. Browser transfers only RSA-OAEP encrypted code.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'

const root = '/wiztek/hzy-test'
const backup = `${root}/backups/runtime-enrollment-c000001-20260905`
const configPath = `${root}/runtime/config.json`
export const enrollmentTarget = {
  tenant: 'C000001', runtime: 'c000001-test-tenant-runtime', version: '0.3.215',
  platform: 'https://hzy.wiztek.cn', endpoint: 'http://127.0.0.1:18084',
  keyId: 'e1f7cfc0fb174116c305766c2a39d90606e22cc5a3c02d1cf7fc749578bcab82',
  bindings: { console: 'wiztek-test-console', people: 'C000001-test-people' }
}
export function assertTestConfig(c) {
  const t = enrollmentTarget
  if (c.tenant !== t.tenant || c.deployment !== t.runtime || c.server?.host !== '127.0.0.1'
    || c.server.port !== 18084 || c.auth?.mode !== 'jwt'
    || c.auth.jwt?.issuer !== 'http://127.0.0.1:3000/console' || !c.auth.jwt.jwksJson
    || Object.keys(c.control || {}).length
    || c.deploymentBindings?.console !== 'C000001-test-console'
    || c.deploymentBindings?.people !== t.bindings.people
    || Object.keys(c.deploymentBindings).length !== 2) throw new Error('Test binding guard')
  for (const app of ['console', 'directory', 'people']) {
    const d = c.apps?.[app]?.db
    if (!c.apps[app].enabled || d?.host !== '127.0.0.1' || d.port !== 13316
      || d.user !== 'hzy_test_runtime' || d.database !== (app === 'people'
        ? 'hzy_people_test_20260905' : 'hzy_console_test_20260905')) throw new Error('Test DB guard')
  }
}
export function enrolledConfig(original, env, trust) {
  assertTestConfig(original)
  const t = enrollmentTarget
  const bindings = JSON.parse(Buffer.from(env.HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64 || '', 'base64'))
  if (env.HZY_DATA_RUNTIME_PLATFORM_URL !== t.platform || env.HZY_DATA_RUNTIME_INSTANCE !== t.runtime
    || env.HZY_DATA_RUNTIME_DEPLOYMENT !== t.runtime || env.HZY_DATA_RUNTIME_PUBLIC_ENDPOINT !== t.endpoint
    || env.HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID !== t.keyId
    || !/^hzy_ctl_[A-Za-z0-9_-]+$/.test(env.HZY_DATA_RUNTIME_CONTROL_TOKEN || '')
    || Object.keys(bindings).length !== 2
    || Object.entries(t.bindings).some(([k, v]) => bindings[k] !== v)
    || !/^[A-Za-z0-9._-]{1,128}$/.test(trust.kid || '') || trust.alg !== 'Ed25519'
    || createPublicKey(trust.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Enrollment binding guard')
  return { ...structuredClone(original), deploymentBindings: bindings, control: {
    platformUrl: t.platform, runtimeCode: t.runtime, token: env.HZY_DATA_RUNTIME_CONTROL_TOKEN,
    runtimeEndpoint: t.endpoint, releaseSigningKeyId: t.keyId, platformSigningKeyId: trust.kid
  } }
}

async function main() {
  const mode = process.argv[2]
  const run = (c, args, opts = {}) => execFileSync(c, args, { stdio: 'pipe', ...opts })
  if (!['--prepare', '--execute'].includes(mode)
    || run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Invocation guard')
  const original = fs.readFileSync(configPath), before = JSON.parse(original)
  assertTestConfig(before)
  const hash = b => createHash('sha256').update(b).digest('hex')
  const processes = () => JSON.parse(run('pm2', ['jlist']))
  const pm = processes(), legacy = pm.find(p => p.name === 'hzy-console-test')
  const dev = pm.find(p => p.name === 'hzy-platform-dev')
  if (!dev?.pid || dev.pm2_env.DB_NAME !== 'hzy_platform_dev'
    || !legacy || legacy.pm2_env.pm_cwd !== '/wiztek/huizhi-yun/ctr812-console-release/console') throw new Error('Process guard')
  for (const file of ['deployment-bindings.json', 'auth-jwt-trust.json', 'platform-signing-key.json']) {
    if (fs.existsSync(`${root}/runtime/${file}`)) throw new Error('Existing overlay requires review')
  }
  const save = (name, value) => fs.writeFileSync(`${backup}/${name}`, value, { mode: 0o600, flag: 'wx' })
  if (mode === '--prepare') {
    fs.mkdirSync(backup, { mode: 0o700 })
    save('runtime-config.json', original)
    save('pm2-before.json', JSON.stringify(pm))
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    save('transfer-private.pem', pair.privateKey)
    save('transfer-public.der', pair.publicKey)
    save('prepared.json', JSON.stringify({ configHash: hash(original), binaryHash: hash(fs.readFileSync(`${root}/runtime/hzy-data-runtime`)) }))
    console.log(JSON.stringify({ backup, target: enrollmentTarget, transferPublicKey: pair.publicKey.toString('base64') }))
    return
  }
  const prepared = JSON.parse(fs.readFileSync(`${backup}/prepared.json`))
  if (hash(original) !== prepared.configHash || hash(fs.readFileSync(`${root}/runtime/hzy-data-runtime`)) !== prepared.binaryHash
    || fs.existsSync(`${backup}/redemption-attempt.json`)) throw new Error('Drift or repeated redemption')
  const input = JSON.parse(fs.readFileSync(0, 'utf8')), t = enrollmentTarget
  if (input.tenantCode !== t.tenant || input.environment !== 'test' || input.runtimeCode !== t.runtime
    || input.desiredVersion !== t.version || input.releaseSigningKeyId !== t.keyId
    || input.platformUrl !== t.platform) throw new Error('Browser response guard')
  const trust = { kid: input.platformSigningKid, alg: 'Ed25519', publicKey: Buffer.from(input.platformSigningPublicKeyBase64, 'base64').toString() }
  if (createPublicKey(trust.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Public trust guard')
  const code = privateDecrypt({ key: fs.readFileSync(`${backup}/transfer-private.pem`),
    padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(input.ciphertext, 'base64')).toString()
  if (!/^hzy_enr_[A-Za-z0-9_-]+$/.test(code)) throw new Error('Enrollment code format')
  save('public-trust.json', JSON.stringify(trust))
  // Stop only the obsolete test BFF, not either Platform or production Runtime.
  run('pm2', ['stop', 'hzy-console-test'])
  run('pm2', ['save'])
  save('redemption-attempt.json', JSON.stringify({ attemptedAt: new Date().toISOString(), runtimeCode: t.runtime }))
  run(`${root}/runtime/hzy-data-runtime`, ['enroll', '--output-env', `${backup}/redeemed.env`], { env: {
    ...process.env, HZY_DATA_RUNTIME_PLATFORM_URL: t.platform, HZY_DATA_RUNTIME_ENROLLMENT_CODE: code,
    HZY_DATA_RUNTIME_INSTANCE: t.runtime, HZY_DATA_RUNTIME_PUBLIC_ENDPOINT: t.endpoint,
    HZY_DATA_RUNTIME_VERSION: t.version, HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID: t.keyId
  }, timeout: 25000 })
  const redeemed = parseEnv(fs.readFileSync(`${backup}/redeemed.env`, 'utf8'))
  const after = enrolledConfig(before, redeemed, trust)
  const writeOwned = (path, data) => {
    fs.writeFileSync(`${path}.enrollment`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    const owner = fs.statSync(configPath)
    fs.chownSync(`${path}.enrollment`, owner.uid, owner.gid)
    fs.renameSync(`${path}.enrollment`, path)
  }
  run('systemctl', ['stop', 'hzy-test-data-runtime'])
  writeOwned(`${root}/runtime/platform-signing-key.json`, trust)
  writeOwned(configPath, after)
  run('systemctl', ['start', 'hzy-test-data-runtime'])
  let healthy = false
  for (let i = 0; i < 15; i++) {
    try {
      const r = await fetch(`${t.endpoint}/runtime/health`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) {
        const h = await r.json()
        if (h.tenant === t.tenant && h.deployment === t.runtime && h.status === 'ok'
          && ['console', 'directory', 'people'].every(app => h.apps?.[app]?.db === 'ok')) { healthy = true; break }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const final = processes()
  const unchanged = pm.filter(p => p.name !== legacy.name).every(p => final.find(q => q.name === p.name)?.pid === p.pid)
  const report = { completedAt: new Date().toISOString(), runtime: t.runtime, bindings: t.bindings,
    platformProcessesUnchanged: unchanged, legacyConsoleStopped: final.find(p => p.name === legacy.name)?.pm2_env.status === 'stopped',
    listenerResponding: healthy, authAndDatabasesUnchanged: JSON.stringify(after.auth) === JSON.stringify(before.auth)
      && JSON.stringify(after.apps) === JSON.stringify(before.apps), backup }
  save('complete.json', JSON.stringify(report))
  console.log(JSON.stringify(report))
  if (!healthy || !unchanged || !report.legacyConsoleStopped) throw new Error('Post-enrollment verification')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Enrollment stopped; credential-bearing diagnostics suppressed. Inspect protected server receipts before retry.'); process.exitCode = 1 })
}
