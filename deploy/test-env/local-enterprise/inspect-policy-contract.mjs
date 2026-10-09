// Read-only policy diagnostic. Never logs tokens, keys, envelopes or user data.
import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, timingSafeEqual, verify } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ownedProcesses } from './process-ownership.mjs'

export function canonicalPolicy(value) {
  if (Array.isArray(value)) return value.map(canonicalPolicy)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalPolicy(value[key])]))
  return value
}

export function inspectPolicyRecord(raw, { remoteKey, localKey, publicKey, kid, now = Date.now() }) {
  const envelope = JSON.parse(raw), record = JSON.parse(envelope.body), bundle = record.value
  const matches = key => {
    const expected = createHmac('sha256', key).update(envelope.body).digest()
    const actual = Buffer.from(String(envelope.mac || ''), 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  const payload = JSON.stringify(canonicalPolicy(bundle.payload))
  return {
    scopeMatches: record.scope === 'managed-cloud-console:test:C000001',
    tenantMatches: bundle.tenantCode === 'C000001' && bundle.payload.tenant?.tenantCode === 'C000001',
    environmentMatches: bundle.payload.environment === 'test',
    remoteMacMatches: matches(remoteKey), localMacMatches: matches(localKey),
    ageMinutes: Math.round((now - record.syncedAt) / 60000),
    withinTestWindow: record.syncedAt <= now && now - record.syncedAt < 93600000,
    hasPolicyVersion: Boolean(bundle.bundleVersion),
    payloadHashMatches: `sha256_${createHash('sha256').update(payload).digest('hex')}` === bundle.bundleHash,
    keyMatches: bundle.kid === kid,
    signatureValid: bundle.alg === 'Ed25519' && bundle.kid === kid
      && verify(null, Buffer.from(payload), publicKey, Buffer.from(bundle.signature, 'base64url'))
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--live-read') throw Error('Explicit --live-read required')
  const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
  const profilePath = '/Users/gavinzhou/.config/huizhi-yun/hzy0/profile.json'
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  if (profile.identity.consoleFacadeMode !== 'local-canonical-facade'
    || profile.processManagement.pm2Home !== '/Users/gavinzhou/.local/state/huizhi-yun/hzy0/pm2') throw Error('Profile mismatch')
  const protectedFile = path => {
    const info = statSync(path)
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Unsafe file')
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  const credentials = protectedFile(`${root}/deploy/test-env/.cloudflare-workers/gateway/secrets.json`)
  const publicConfig = protectedFile(`${root}/deploy/test-env/.cloudflare-workers/console/secrets.json`)
  const vars = JSON.parse(readFileSync(`${root}/deploy/test-env/.cloudflare-workers/gateway/wrangler.json`, 'utf8')).vars
  const tenant = JSON.parse(credentials.HZY_TENANT_GATEWAY_REGISTRY_JSON).domains['hzy-test.huizhi.yun']
  if (tenant.tenantCode !== 'C000001' || tenant.environment !== 'test'
    || tenant.apps.console.deploymentCode !== 'wiztek-test-console'
    || tenant.dataRuntime.endpoint !== 'https://hzy-test-runtime.isme.dev') throw Error('Binding mismatch')
  const rows = JSON.parse(execFileSync('pm2', ['jlist'], { env: { ...process.env, PM2_HOME: profile.processManagement.pm2Home },
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }))
  ownedProcesses(rows, { root, profilePath, mode: 'dev' })
  const localKey = rows.find(row => row.name === 'hzy0-console')?.pm2_env.HZY0_GATEWAY_INTERNAL_TOKEN
  if (!localKey) throw Error('Missing local identity')
  const request = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
  const { resolveRuntimeBootstrapToken } = await import('../../cloudflare/tenant-gateway/src/index.js')
  const bootstrap = await resolveRuntimeBootstrapToken({ ...vars, ...credentials }, tenant, request)
  const tokenResponse = await request(`${tenant.dataRuntime.endpoint}/v1/console/auth/service-tokens/issue`, {
    method: 'POST', headers: { authorization: `Bearer ${bootstrap}`, 'content-type': 'application/json' },
    body: JSON.stringify({ audience: 'data-runtime', scope: 'console:policy-bundle:read', issuer: 'https://hzy-test.huizhi.yun',
      ttlSeconds: 120, sourceBinding: 'service-client-policy', policyVersion: null, caps: null })
  })
  if (!tokenResponse.ok) return console.log(JSON.stringify({ stage: 'read_token', status: tokenResponse.status }))
  const token = (await tokenResponse.json()).data.accessToken
  const key = `policy/v1/${createHash('sha256').update('managed-cloud-console:test:C000001').digest('hex')}.json`
  const response = await request(`${tenant.dataRuntime.endpoint}/v1/console/policy-bundle?${new URLSearchParams({ key })}`, {
    headers: { authorization: `Bearer ${token}` }
  })
  if (!response.ok) return console.log(JSON.stringify({ stage: 'read_policy', status: response.status }))
  const record = (await response.json()).data
  if (!record) return console.log(JSON.stringify({ stage: 'read_policy', recordExists: false }))
  console.log(JSON.stringify({ stage: 'integrity', status: response.status, recordExists: true,
    ...inspectPolicyRecord(record.body, { localKey,
      remoteKey: credentials.HZY_TENANT_GATEWAY_INTERNAL_TOKEN || credentials.HZY_CLOUDFLARE_INTERNAL_TOKEN,
      publicKey: publicConfig.HZY_PLATFORM_SIGNING_PUBKEY, kid: publicConfig.HZY_PLATFORM_SIGNING_KID }) }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Policy diagnostic failed; sensitive details suppressed'); process.exitCode = 1 })
}
