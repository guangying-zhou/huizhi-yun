import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { inspectLocalReadiness, probePolicyServices, sameVerificationKey, validateReadinessTarget } from '../verified-policy-readiness.mjs'

test('readiness only reads metadata and never equates grants with acceptance', async () => {
  const queries = []
  const result = await inspectLocalReadiness({
    query: async sql => {
      queries.push(sql)
      assert.match(sql, /^SELECT /)
      return sql.includes('information_schema') ? [[{ name: 'policy_bundle_snapshots' }]] : [[
        { client: 'console.runtime', action: 'read', clientStatus: 'active', credentialStatus: 'active', grantStatus: 'active' },
        { client: 'console.runtime', action: 'write', clientStatus: 'active', credentialStatus: 'disabled', grantStatus: 'active' },
        { client: 'enterprise.runtime', action: 'read', clientStatus: 'active', credentialStatus: 'active', grantStatus: 'disabled' }
      ]]
    }, health: { version: 'fixture', commit: 'fixture', builtAt: 'fixture' }, config: { apps: { console: {} } }, keyMatches: true
  })
  assert.equal(queries.length, 2)
  assert.equal(result.acceptancePassed, false)
  assert.equal(result.schema.verifiedTable, false)
  assert.deepEqual(result.grants, { consoleRead: true, consoleWrite: false, enterpriseRead: false, enterpriseWrite: false })
})

test('verification key comparison checks both pinned kid and actual public key', () => {
  const first = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const second = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const configured = { HZY_PLATFORM_SIGNING_KID: 'fixture', HZY_PLATFORM_SIGNING_PUBKEY: first }
  assert.equal(sameVerificationKey({ alg: 'Ed25519', kid: 'fixture', publicKey: first }, configured), true)
  assert.equal(sameVerificationKey({ alg: 'Ed25519', kid: 'wrong', publicKey: first }, configured), false)
  assert.equal(sameVerificationKey({ alg: 'Ed25519', kid: 'fixture', publicKey: second }, configured), false)
  assert.throws(() => validateReadinessTarget({}, {}), /target_mismatch/)
})

test('service probe issues only precise tokens, never writes policy, and prevents legacy on-demand generation', async () => {
  const calls = []
  const result = await probePolicyServices({ bootstrap: 'fixture-bootstrap', platformToken: 'fixture-platform',
    request: async (input, options = {}) => {
      const url = new URL(input)
      calls.push({ url, options })
      if (url.pathname.endsWith('/issue')) {
        assert.equal(options.method, 'POST')
        const body = JSON.parse(options.body)
        assert.ok(['data-runtime', 'tenant-runtime'].includes(body.audience))
        assert.equal(body.sourceBinding, 'service-client-policy')
        assert.equal(body.policyVersion, null)
        assert.equal(body.ttlSeconds, 60)
        return Response.json({ data: { accessToken: 'fixture-token' } })
      }
      assert.equal(options.method, undefined)
      if (url.hostname === 'hzy.wiztek.cn') {
        assert.equal(url.searchParams.get('format'), 'hzy-policy-envelope.v1')
        assert.equal(url.searchParams.get('version'), 'hzy0-readiness-no-generation')
        assert.equal(url.searchParams.get('environment'), 'test')
        return Response.json({ message: 'Historical policy envelopes cannot be renewed' }, { status: 400 })
      }
      assert.equal(url.pathname, '/v1/console/verified-policy')
      return Response.json({ error: { code: 'not_found' } }, { status: 404 })
    } })
  assert.equal(result.tokenResults.length, 6)
  assert.equal(calls.length, 8)
  assert.equal(result.platform.newFormatGuardObserved, true)
  assert.equal(result.platform.freshDeliveryVerified, false)
  assert.doesNotMatch(JSON.stringify(result), /fixture-token|fixture-bootstrap|fixture-platform/)
})

test('probe failures retain safe partial evidence without leaking transport diagnostics', async () => {
  await assert.rejects(probePolicyServices({ bootstrap: 'secret', platformToken: 'secret', request: async url => {
    if (url.includes('/issue')) return Response.json({ data: { accessToken: 'secret' } })
    if (url.includes('/verified-policy')) return Response.json({}, { status: 404 })
    throw Error('sensitive upstream detail secret')
  } }), error => {
    assert.equal(error.probeStage, 'platform_format_guard')
    assert.equal(error.runtimeReadStatus, 404)
    assert.equal(error.tokenResults.length, 6)
    assert.doesNotMatch(String(error) + JSON.stringify(error), /secret|sensitive/)
    return true
  })
})
