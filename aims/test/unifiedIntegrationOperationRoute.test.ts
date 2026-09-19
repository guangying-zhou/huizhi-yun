import assert from 'node:assert/strict'
import test from 'node:test'
import { unifiedIntegrationOperationRoute } from '../server/utils/unifiedIntegrationOperationRoute.ts'

test('unified transport preserves frozen key and ACK evidence across all three actions', () => {
  const operationKey = 'aims:feedback:ticket/17'
  for (const action of ['claim', 'succeed', 'fail']) {
    const evidence = action === 'claim' ? {} : { operationId: 'op-17', fencingToken: '9223372036854775807', receiptCommandSha256: 'frozen-hash' }
    const routed = unifiedIntegrationOperationRoute(`/v1/aims/integration-operations/${encodeURIComponent(operationKey)}:${action}`, evidence)
    assert.equal(routed.path, `/v1/enterprise/aims/integration-operations:${action}`)
    assert.deepEqual(routed.body, { ...evidence, operationKey })
    assert.equal('operationKey' in evidence, false)
  }
})

test('unified transport never falls back for unsupported paths or conflicting identity', () => {
  assert.deepEqual(unifiedIntegrationOperationRoute('/v1/aims/integration-operations:claim-next', {}), { path: '/v1/enterprise/aims/integration-operations:claim', body: {} })
  for (const path of ['/v1/aims/integration-operations:unknown', '/v1/aims/integration-operations/key:succeed?tenant=other', '/v1/aims/integration-operations/%20:claim']) {
    assert.throws(() => unifiedIntegrationOperationRoute(path, {}))
  }
  assert.throws(() => unifiedIntegrationOperationRoute('/v1/aims/integration-operations/key:succeed', { operationKey: 'other' }))
  assert.throws(() => unifiedIntegrationOperationRoute('/v1/aims/integration-operations:claim-next', { worker: 'other' }))
})

test('notification queries and acknowledgements retain versions, recipients and operation IDs', () => {
  for (const action of ['pending-failure-notifications', 'pending-dead-letter-actionables', 'pending-dead-letter-closures']) {
    assert.deepEqual(unifiedIntegrationOperationRoute(`/v1/aims/integration-operations:${action}`, { limit: 7 }), {
      path: `/v1/enterprise/aims/integration-operations:${action}`, body: { limit: 7 }
    })
  }
  const evidence = { generation: '18446744073709551615', operationVersion: '42', recipientUids: ['user-a'], expectedVersion: 'v1', nextVersion: 'v2', notificationId: 'notice-a' }
  for (const action of ['failure-notified', 'dead-letter-actionable-published', 'dead-letter-closure-acknowledged']) {
    assert.deepEqual(unifiedIntegrationOperationRoute(`/v1/aims/integration-operations/op-17:${action}`, evidence), {
      path: `/v1/enterprise/aims/integration-operations:${action}`, body: { ...evidence, operationId: 'op-17' }
    })
    assert.throws(() => unifiedIntegrationOperationRoute(`/v1/aims/integration-operations/op-17:${action}`, { operationId: 'other' }))
  }
})
