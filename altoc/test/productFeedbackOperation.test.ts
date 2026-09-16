import assert from 'node:assert/strict'
import test from 'node:test'
import { executeProductFeedbackOperation } from '../server/utils/productFeedbackOperation.ts'

function operation() {
  return {
    operationId: '123e4567-e89b-42d3-a456-426614174000', operationKey: 'feedback-key',
    tenantCode: 'tenant', deploymentCode: 'altoc-deployment', sourceApp: 'altoc', targetApp: 'aims',
    operationCode: 'altoc.aims.product-request.create-from-feedback.v1', requiredCapability: 'aims:product-request:create-from-feedback',
    idempotencyKey: 'feedback-key', commandSchemaVersion: 'product-feedback-create.v1', commandSha256: 'a'.repeat(64), fencingToken: 2,
    originalActorUid: 'pm',
    command: { actorUid: 'pm', productCode: 'P1', ticketCode: 'ST-1', requestBizId: '123e4567-e89b-42d3-a456-426614174002', title: 'Feature', description: '', action: 'create' }
  }
}

test('feedback executor validates receipt and preserves uncertain source acknowledgement', async () => {
  for (const mode of ['success', 'wrong-target', 'lost-ack', 'actor']) {
    const value = operation()
    if (mode === 'actor') value.originalActorUid = 'other'
    const calls: string[] = []
    const result = await executeProductFeedbackOperation(value, {
      async callService() { throw new Error('unsigned transport must not be used') },
      async callProductFeedback(received) {
        calls.push('service')
        assert.equal(received.operationId, value.operationId)
        assert.equal(received.originalActorUid, 'pm')
        return {
          receiptId: '123e4567-e89b-42d3-a456-426614174003', receiptStatus: 'succeeded',
          operationId: value.operationId, operationCode: value.operationCode, idempotencyKey: value.idempotencyKey,
          commandSchemaVersion: value.commandSchemaVersion, commandSha256: value.commandSha256,
          targetBizType: 'product_request', targetBizCode: mode === 'wrong-target' ? 'OTHER' : value.command.requestBizId,
          responseSummarySha256: 'b'.repeat(64), idempotent: false
        } as never
      },
      async callRuntime(path, body) {
        const action = path.endsWith(':succeed') ? 'succeed' : 'fail'
        calls.push(action)
        if (action === 'succeed') {
          assert.equal(body.receiptCommandSchemaVersion, value.commandSchemaVersion)
          assert.equal(body.targetBizCode, value.command.requestBizId)
          if (mode === 'lost-ack') throw new Error('connection lost')
        }
        return { status: action === 'succeed' ? 'succeeded' : 'retry_wait' } as never
      }
    })
    assert.equal(result.succeeded, mode === 'success')
    assert.deepEqual(calls, mode === 'actor' ? ['fail'] : mode === 'wrong-target' ? ['service', 'fail'] : ['service', 'succeed'])
  }
})
