import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalGatewayScope, gatewayExchangeAllowsLegacy, gatewayExchangeWithLegacy, GATEWAY_EXCHANGE_PATH, GATEWAY_ASSERTION_TYPE } from '../shared/utils/gatewayAssertionContract'

test('Gateway fallback only selects the explicit keyset absence, once, without resigning', async () => {
  let exchanges = 0, oldCalls = 0
  const token = await gatewayExchangeWithLegacy(async () => {
    exchanges++
    return { status: 503, code: 'gateway_keyset_unavailable' }
  }, async () => {
    oldCalls++
    return 'legacy-token'
  })
  assert.equal(token, 'legacy-token')
  assert.equal(exchanges, 1)
  assert.equal(oldCalls, 1)
  for (const code of ['gateway_assertion_invalid', 'gateway_assertion_replayed', 'gateway_assertion_key_invalid', 'gateway_keyset_invalid', 'gateway_replay_storage_unavailable', 'insufficient_scope', 'gateway_exchange_disabled', 'internal_error', undefined]) {
    assert.equal(gatewayExchangeAllowsLegacy(503, code), false)
    await assert.rejects(gatewayExchangeWithLegacy(async () => ({ status: 503, code }), async () => {
      oldCalls++
      return 'unexpected'
    }))
  }
  for (const status of [200, 400, 401, 403, 404, 409, 500, 502, 504]) assert.equal(gatewayExchangeAllowsLegacy(status, 'gateway_keyset_unavailable'), false)
  await assert.rejects(gatewayExchangeWithLegacy(async () => {
    throw new Error('network')
  }, async () => {
    oldCalls++
    return 'unexpected'
  }))
  assert.equal(oldCalls, 1)
})
test('exchange success returns one token and no legacy call; purpose matches Runtime', async () => {
  assert.equal(await gatewayExchangeWithLegacy(async () => ({ status: 200, result: 'one-token' }), async () => {
    throw new Error('must not call')
  }), 'one-token')
  assert.equal(canonicalGatewayScope('b  a a'), 'a b')
  const source = readFileSync(new URL('../../data-runtime/internal/gatewaykeys/assertion.go', import.meta.url), 'utf8')
  assert.ok(source.includes(`"${GATEWAY_EXCHANGE_PATH}"`))
  assert.ok(source.includes(`"${GATEWAY_ASSERTION_TYPE}"`))
})
