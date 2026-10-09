import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectCollabToken, probeCollabTokens, saveCollabEvidence } from '../probe-collab-token.mjs'
const scope = 'codocs:collaboration-snapshots:read'
const claims = { token_use: 'service', aud: 'data-runtime', target_app: 'data-runtime', source_app: 'collab', tenant: 'C000001', deployment: 'C000001-test-collab', scope, exp: 3000, iat: 900, iss: 'issuer' }
const token = value => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature-secret`
const body = value => ({ access_token: token(value), token_type: 'Bearer' })
test('exact Collab claims pass; each mismatched claim is identified without values', () => {
  assert.equal(inspectCollabToken(200, body(claims), scope, 1000).ok, true)
  for (const key of ['aud', 'target_app', 'source_app', 'tenant', 'deployment', 'scope', 'token_use', 'exp', 'iat', 'iss']) {
    const changed = { ...claims }; delete changed[key]
    const result = inspectCollabToken(200, body(changed), scope, 1000)
    assert.ok(result.failedChecks.includes(key)); assert.equal(result.ok, false)
    assert.ok(!JSON.stringify(result).includes('signature-secret'))
  }
  assert.equal(inspectCollabToken(403, { error: { code: 'console_service_token_grant_inactive' } }, scope).errorCode, 'console_service_token_grant_inactive')
  assert.equal(inspectCollabToken(503, { code: 'secret text with /path' }, scope).errorCode, null)
})
test('failed HTTP and transport probes are automatically persisted privately, without response secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collab-probe-'))
  try {
    writeFileSync(join(root, 'collab-client-secret.json'), JSON.stringify({ COLLAB_SERVICE_CLIENT_SECRET: 'DO-NOT-LOG' }), { mode: 0o600 })
    let calls = 0
    const evidence = await probeCollabTokens({ profilePath: join(root, 'profile.json'), gatewayPort: 23120, evidenceDirectory: join(root, 'evidence'), fetchImpl: async () => {
      if (calls++) throw Error('DO-NOT-LOG transport')
      return { status: 403, json: async () => ({ code: 'grant_denied', access_token: 'DO-NOT-LOG' }) }
    } })
    assert.equal(evidence.ok, false); assert.equal(evidence.probes.length, 2)
    assert.equal(evidence.probes[0].errorCode, 'grant_denied'); assert.equal(evidence.probes[1].errorCode, 'probe_transport_failed')
    const path = join(root, 'evidence', readdirSync(join(root, 'evidence'))[0])
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(statSync(join(root, 'evidence')).mode & 0o777, 0o700)
    assert.ok(!readFileSync(path, 'utf8').includes('DO-NOT-LOG'))
    mkdirSync(join(root, 'unsafe'), { mode: 0o755 })
    assert.throws(() => saveCollabEvidence(join(root, 'unsafe'), evidence), /UNSAFE/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
