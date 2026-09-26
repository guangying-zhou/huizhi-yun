// Pinned live verification. Uses existing approved identities; prints no JWT,
// secret, full policy, user data or raw upstream diagnostics. No grant changes.
import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createConsoleFacade } from './console-facade.mjs'
import { resolveRuntimeBootstrapToken } from '../../cloudflare/tenant-gateway/src/index.js'
import { ownedProcesses } from './process-ownership.mjs'
import { verifyRuntimePolicySnapshot } from '../../../foundation/server/utils/verifiedPolicySnapshot.ts'

const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const profilePath = '/Users/gavinzhou/.config/huizhi-yun/hzy0/profile.json'
const runtime = 'https://hzy-test-runtime.isme.dev'
function json(path) {
  const stat = statSync(path)
  assert.ok(stat.uid === process.getuid() && !(stat.mode & 0o077))
  return JSON.parse(readFileSync(path, 'utf8'))
}
async function main() {
  const receiptPath = `${root}/deploy/test-env/artifacts/C000001.local-verified-policy-probes.json`
  const prior = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath)) : null
  const profile = json(profilePath)
  assert.equal(profile.identity.policyBackend, 'verified-runtime')
  const processes = spawnSync('pm2', ['jlist'], { encoding: 'utf8', env: { ...process.env, PM2_HOME: profile.processManagement.pm2Home } })
  assert.equal(processes.status, 0)
  const rows = JSON.parse(processes.stdout)
  ownedProcesses(rows, { root, profilePath, mode: 'dev' })
  const localSecret = rows.find(row => row.name === 'hzy0-gateway').pm2_env.HZY0_GATEWAY_INTERNAL_TOKEN
  const credentials = json(`${root}/deploy/test-env/.cloudflare-workers/gateway/secrets.json`)
  const registryVars = JSON.parse(readFileSync(`${root}/deploy/test-env/.cloudflare-workers/gateway/wrangler.json`)).vars
  const t = JSON.parse(credentials.HZY_TENANT_GATEWAY_REGISTRY_JSON).domains['hzy-test.huizhi.yun']
  const tenant = { ...t, apps: { ...t.apps, enterprise: { deploymentCode: 'C000001-test-enterprise' } } }
  const facade = createConsoleFacade({ localSecret, credentials, registryVars, tenant })
  const trust = json(`${root}/deploy/test-env/.cloudflare-workers/console/secrets.json`)
  const key = { kid: trust.HZY_PLATFORM_SIGNING_KID, publicKey: trust.HZY_PLATFORM_SIGNING_PUBKEY }
  const request = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
  const bootstrap = await resolveRuntimeBootstrapToken({ ...registryVars, ...credentials }, tenant, request)
  const tokens = {}, result = { observedAt: new Date().toISOString(), tokenProbes: [], routeProbes: [], acceptancePassed: false }
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const app of ['console', 'enterprise']) {
      const scope = 'console:policy-bundle:read'
      const response = app === 'console'
        ? await request(`${runtime}/v1/console/auth/service-tokens/issue`, {
          method: 'POST', headers: { authorization: `Bearer ${bootstrap}`, 'content-type': 'application/json' },
          body: JSON.stringify({ audience, scope, issuer: 'https://hzy-test.huizhi.yun', ttlSeconds: 300, sourceBinding: 'service-client-policy' }) })
        : await facade.fetch('https://hzy-test.huizhi.yun/oauth/token', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience, scope, source_binding: 'service-client-policy' }) })
      const body = await response.json().catch(() => null)
      const token = app === 'console' ? body?.data?.accessToken : body?.access_token
      result.tokenProbes.push({ app, audience, scope, status: response.status, issued: !!token })
      console.log(JSON.stringify({ ...result.tokenProbes.at(-1), ...(!response.ok ? { errorCode: String(body?.data?.code || body?.code || '').slice(0, 100), message: String(body?.message || body?.error_description || '').replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]').slice(0, 150) } : {}) }))
      assert.equal(response.status, 200); assert.ok(token)
      const path = app === 'console' ? '/v1/console/verified-policy' : '/v1/enterprise/console-policy'
      const read = await request(runtime + path, { headers: { authorization: `Bearer ${token}` } })
      const snapshot = (await read.json())?.data
      console.log(JSON.stringify({ stage: 'read', app, audience, status: read.status }))
      if (audience === 'tenant-runtime') {
        // Both issuances are required, but this instance pins data-runtime.
        // A correctly signed alternate-audience JWT must remain rejected here.
        assert.equal(read.status, 401)
        result.routeProbes.push({ app, audience, status: read.status, expectedAudienceRejection: true })
        continue
      }
      assert.equal(read.status, 200)
      const verified = verifyRuntimePolicySnapshot(snapshot, key, { issuer: 'https://hzy.wiztek.cn', tenant: 'C000001', environment: 'test', deployment: tenant.apps[app].deploymentCode, now: Date.now() })
      result.routeProbes.push({ app, audience, status: read.status, revision: verified.body.policyRevision, issuedAt: snapshot.issuedAt, acceptedAt: snapshot.acceptedAt })
      tokens[app] = token
      if (app === 'enterprise') result.firstSnapshot = { issuedAt: snapshot.issuedAt, acceptedAt: snapshot.acceptedAt, revision: snapshot.policyRevision, etag: snapshot.etag }
    }
  }
  const denied = await facade.fetch('https://hzy-test.huizhi.yun/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope: 'console:policy-bundle:write', source_binding: 'service-client-policy' }) })
  const deniedBody = await denied.json()
  assert.ok([400, 403].includes(denied.status))
  assert.ok(['invalid_scope', 'insufficient_scope'].includes(deniedBody?.data?.code || deniedBody?.error || deniedBody?.code))
  result.enterpriseWriteDenied = true
  result.enterpriseWriteStatus = denied.status
  for (const [token, path, method, expected] of [[tokens.console, '/v1/enterprise/console-policy', 'GET', 403],
    [tokens.enterprise, '/v1/console/verified-policy', 'GET', 403], [tokens.enterprise, '/v1/enterprise/console-policy', 'PUT', 405]]) {
    const response = await request(runtime + path, { method, headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.status, expected); await response.body?.cancel()
    result.routeProbes.push({ method, path, status: response.status })
  }
  if (prior?.firstSnapshot?.issuedAt < result.firstSnapshot.issuedAt) result.periodicRefresh = {
    previousIssuedAt: prior.firstSnapshot.issuedAt, currentIssuedAt: result.firstSnapshot.issuedAt,
    sameRevision: prior.firstSnapshot.revision === result.firstSnapshot.revision, signatureVerified: true
  }
  // Replay the exact currently committed envelope; never mint a fresh envelope
  // for retry. This tests the real receipt, not a destructive response fault.
  const issued = await request(`${runtime}/v1/console/auth/service-tokens/issue`, { method: 'POST',
    headers: { authorization: `Bearer ${bootstrap}`, 'content-type': 'application/json' },
    body: JSON.stringify({ audience: 'data-runtime', scope: 'console:policy-bundle:write', issuer: 'https://hzy-test.huizhi.yun', ttlSeconds: 60, sourceBinding: 'service-client-policy' }) })
  assert.equal(issued.status, 200)
  const writeToken = (await issued.json()).data.accessToken
  const currentResponse = await request(`${runtime}/v1/console/verified-policy`, { headers: { authorization: `Bearer ${tokens.console}` } })
  assert.equal(currentResponse.status, 200)
  const current = (await currentResponse.json()).data
  const replay = await request(`${runtime}/v1/console/verified-policy`, { method: 'PUT',
    headers: { authorization: `Bearer ${writeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: current.envelope, expectedEtag: current.etag }) })
  assert.equal(replay.status, 200)
  const replayed = (await replay.json()).data
  assert.equal(replayed.etag, current.etag); assert.equal(replayed.acceptedAt, current.acceptedAt)
  result.realStoreReplay = { status: replay.status, identicalReceipt: true, acceptanceTimeUnchanged: true }
  writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
main().catch(() => { console.error('Live policy probe failed; sensitive details suppressed'); process.exitCode = 1 })
