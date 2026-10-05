import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationCode,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  sanitizeServiceOperationErrorSummary,
  validateServiceCommandReceipt
} from '../server/utils/serviceOperation.ts'

describe('service command receipt envelope', () => {
  test('binds immutable claimed metadata and the frozen command', () => {
    const command = { ticketCode: 'ST-1', deliveryStatus: 'closed' }
    assert.deepEqual(buildServiceCommandEnvelope({
      operationId: 'd45ad8b7-15b8-45fa-8498-7167ee64d008',
      targetApp: 'altoc',
      operationCode: 'aims.work-item.ticket-result.v1',
      requiredCapability: 'altoc:service_ticket:delivery-result:sync',
      idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
      commandSchemaVersion: 'v1',
      commandSha256: 'a'.repeat(64),
      correlationKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
      command
    }), {
      serviceCommand: {
        operationId: 'd45ad8b7-15b8-45fa-8498-7167ee64d008',
        targetApp: 'altoc',
        operationCode: 'aims.work-item.ticket-result.v1',
        requiredCapability: 'altoc:service_ticket:delivery-result:sync',
        idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
        commandSchemaVersion: 'v1',
        commandSha256: 'a'.repeat(64),
        correlationId: 'aims:work-item:WI-1:ticket-result:closed:v1',
        command
      }
    })
  })

  test('rejects missing or malformed receipt metadata before network I/O', () => {
    assert.throws(() => buildServiceCommandEnvelope({
      operationId: '',
      targetApp: 'altoc',
      operationCode: 'op.v1',
      requiredCapability: 'altoc:write',
      idempotencyKey: 'key',
      commandSchemaVersion: 'v1',
      commandSha256: 'not-a-digest',
      command: {}
    }), /metadata is invalid/)
  })

  test('requires a stable non-secret capability in the frozen envelope', () => {
    const operation = {
      operationId: 'd45ad8b7-15b8-45fa-8498-7167ee64d008',
      targetApp: 'altoc',
      operationCode: 'aims.work-item.ticket-result.v1',
      requiredCapability: 'altoc:service_ticket:delivery-result:sync',
      idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
      commandSchemaVersion: 'v1',
      commandSha256: 'a'.repeat(64),
      command: { ticketCode: 'ST-1' }
    }

    for (const requiredCapability of ['', 'contains whitespace', 'sk-abcdefghijklmnop']) {
      assert.throws(
        () => buildServiceCommandEnvelope({ ...operation, requiredCapability }),
        /metadata is invalid/,
        `capability ${JSON.stringify(requiredCapability)} must not be signed`
      )
    }
  })

  test('accepts only a receipt bound to the claimed operation and target business key', () => {
    const operation = {
      operationId: 'd45ad8b7-15b8-45fa-8498-7167ee64d008',
      targetApp: 'altoc',
      operationCode: 'aims.work-item.ticket-result.v1',
      requiredCapability: 'altoc:service_ticket:delivery-result:sync',
      idempotencyKey: 'aims:work-item:WI-1:ticket-result:closed:v1',
      commandSchemaVersion: 'v1',
      commandSha256: 'a'.repeat(64),
      command: { ticketCode: 'ST-1' }
    }
    const receipt = {
      receiptId: '660e8400-e29b-41d4-a716-446655440000',
      receiptStatus: 'succeeded',
      operationId: operation.operationId,
      operationCode: operation.operationCode,
      idempotencyKey: operation.idempotencyKey,
      commandSchemaVersion: 'v1',
      commandSha256: operation.commandSha256,
      targetBizType: 'service_ticket',
      targetBizCode: 'ST-1',
      responseSummarySha256: 'b'.repeat(64),
      idempotent: true
    }
    assert.deepEqual(validateServiceCommandReceipt(operation, receipt, {
      targetBizType: 'service_ticket', targetBizCode: 'ST-1'
    }), receipt)
    const identityMismatches = [
      { name: 'operation id', receipt: { ...receipt, operationId: '770e8400-e29b-41d4-a716-446655440000' } },
      { name: 'operation code', receipt: { ...receipt, operationCode: 'aims.work-item.ticket-result.v2' } },
      { name: 'idempotency key', receipt: { ...receipt, idempotencyKey: 'aims:work-item:WI-1:ticket-result:open:v1' } },
      { name: 'command schema', receipt: { ...receipt, commandSchemaVersion: 'v2' } },
      { name: 'command hash', receipt: { ...receipt, commandSha256: 'c'.repeat(64) } },
      { name: 'target business type', receipt: { ...receipt, targetBizType: 'other' } },
      { name: 'target business code', receipt: { ...receipt, targetBizCode: 'ST-OTHER' } }
    ]
    for (const mismatch of identityMismatches) {
      assert.throws(
        () => validateServiceCommandReceipt(operation, mismatch.receipt, {
          targetBizType: 'service_ticket', targetBizCode: 'ST-1'
        }),
        /does not match/,
        mismatch.name
      )
    }
  })
})

describe('service operation failure extraction', () => {
  test('extracts ofetch response status and nested stable code', () => {
    const error = {
      name: 'FetchError',
      response: {
        status: 503,
        _data: {
          error: { code: 'runtime_unavailable', message: 'runtime unavailable' }
        }
      }
    }

    assert.equal(extractServiceOperationStatus(error), 503)
    assert.equal(extractServiceOperationCode(error), 'runtime_unavailable')
    assert.deepEqual(classifyServiceOperationFailure(error), {
      statusCode: 503,
      code: 'runtime_unavailable',
      classification: 'transient',
      retryable: true,
      idempotentSuccess: false,
      timedOut: false,
      networkError: false,
      summary: 'runtime unavailable'
    })
  })

  test('preserves true upstream 401 and 403 instead of generic wrapper 502', () => {
    const unauthorized = classifyServiceOperationFailure({
      statusCode: 502,
      message: 'Tenant Runtime request failed',
      data: {
        upstreamStatus: 401,
        code: 'invalid_service_token',
        message: 'service token rejected'
      }
    })
    assert.equal(unauthorized.statusCode, 401)
    assert.equal(unauthorized.classification, 'authentication')
    assert.equal(unauthorized.retryable, false)
    assert.equal(unauthorized.code, 'invalid_service_token')

    const forbidden = classifyServiceOperationFailure({
      statusCode: 403,
      data: { code: 'insufficient_capability', message: 'capability denied' }
    })
    assert.equal(forbidden.statusCode, 403)
    assert.equal(forbidden.classification, 'authorization')
    assert.equal(forbidden.retryable, false)
  })

  test('classifies deterministic HTTP errors as contract failures', () => {
    for (const statusCode of [400, 404, 422]) {
      const failure = classifyServiceOperationFailure({ statusCode, data: { code: `error_${statusCode}` } })
      assert.equal(failure.classification, 'contract')
      assert.equal(failure.retryable, false)
    }
  })
})

describe('service operation 409 disposition', () => {
  const conflict = { statusCode: 409, data: { code: 'operation_conflict', message: 'conflict' } }

  test('requires callers to provide an explicit disposition', () => {
    assert.throws(
      () => classifyServiceOperationFailure(conflict),
      /conflictDisposition is required/
    )
  })

  test('distinguishes existing success, processing, and permanent conflicts', () => {
    const existing = classifyServiceOperationFailure(conflict, { conflictDisposition: 'idempotent_success' })
    assert.equal(existing.classification, 'conflict')
    assert.equal(existing.retryable, false)
    assert.equal(existing.idempotentSuccess, true)

    const processing = classifyServiceOperationFailure(conflict, { conflictDisposition: 'processing' })
    assert.equal(processing.classification, 'transient')
    assert.equal(processing.retryable, true)
    assert.equal(processing.idempotentSuccess, false)

    for (const disposition of ['payload_mismatch', 'binding_conflict', 'permanent'] as const) {
      const permanent = classifyServiceOperationFailure(conflict, { conflictDisposition: disposition })
      assert.equal(permanent.classification, 'conflict')
      assert.equal(permanent.retryable, false)
      assert.equal(permanent.idempotentSuccess, false)
    }
  })

  test('resolves stable conflict codes conservatively without inspecting messages', () => {
    const disposition = (code: string, message = 'localized text') => resolveServiceOperationConflictDisposition({
      statusCode: 409,
      data: { code, message }
    })

    assert.equal(disposition('operation_already_succeeded'), 'idempotent_success')
    assert.equal(disposition('runtime_update_in_progress'), 'processing')
    assert.equal(disposition('idempotency_key_conflict'), 'payload_mismatch')
    assert.equal(disposition('service_ticket_delivery_binding_conflict'), 'binding_conflict')
    assert.equal(disposition('ops_knowledge_asset_environment_mismatch'), 'binding_conflict')
    assert.equal(disposition('unknown_conflict', 'already succeeded'), 'permanent')
  })
})

describe('service operation transient failures', () => {
  test('classifies retryable HTTP statuses without rewriting them', () => {
    for (const statusCode of [408, 425, 429, 500, 503, 599]) {
      const failure = classifyServiceOperationFailure({ statusCode, message: `HTTP ${statusCode}` })
      assert.equal(failure.statusCode, statusCode)
      assert.equal(failure.classification, 'transient')
      assert.equal(failure.retryable, true)
    }
  })

  test('detects timeout and nested network errors with no HTTP response', () => {
    const timeout = classifyServiceOperationFailure(Object.assign(new Error('request timed out'), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT'
    }))
    assert.equal(timeout.statusCode, undefined)
    assert.equal(timeout.classification, 'transient')
    assert.equal(timeout.timedOut, true)
    assert.equal(timeout.networkError, true)

    const network = classifyServiceOperationFailure(new Error('operation failed', {
      cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    }))
    assert.equal(network.classification, 'transient')
    assert.equal(network.networkError, true)
    assert.equal(network.code, 'ECONNRESET')
  })

  test('handles unknown thrown values safely', () => {
    const failure = classifyServiceOperationFailure('unknown transport failure')
    assert.equal(failure.statusCode, undefined)
    assert.equal(failure.classification, 'transient')
    assert.equal(failure.code, 'service_operation_failed')
    assert.equal(failure.summary, 'unknown transport failure')
  })
})

describe('service operation safe error summaries', () => {
  test('redacts URLs and credential-like values', () => {
    const summary = sanitizeServiceOperationErrorSummary(
      'POST https://runtime.internal/v1?token=leak failed; Bearer abc.def.ghi; '
      + 'authorization=opaque-auth token=plain-token cookie=session-cookie password=hunter2 sk-abcdefghijklmnop'
    )

    for (const leaked of [
      'runtime.internal',
      'abc.def.ghi',
      'opaque-auth',
      'plain-token',
      'session-cookie',
      'hunter2',
      'sk-abcdefghijklmnop'
    ]) {
      assert.equal(summary.includes(leaked), false, `summary leaked ${leaked}: ${summary}`)
    }
    assert.match(summary, /\[redacted-(?:url|secret)\]/)
  })

  test('limits summaries by Unicode code points', () => {
    assert.equal(sanitizeServiceOperationErrorSummary('一二三四五六', 4), '一二三四')
  })

  test('sanitizes extracted H3/ofetch messages before returning them', () => {
    const failure = classifyServiceOperationFailure({
      statusCode: 503,
      data: {
        code: 'upstream_failed',
        message: 'https://private.internal failed with password=secret-value'
      }
    }, { maxSummaryLength: 80 })
    assert.equal(failure.summary.includes('private.internal'), false)
    assert.equal(failure.summary.includes('secret-value'), false)
    assert.ok([...failure.summary].length <= 80)
  })
})
