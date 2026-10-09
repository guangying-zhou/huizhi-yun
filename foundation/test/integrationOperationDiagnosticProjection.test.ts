import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  projectIntegrationOperationAttempts,
  projectIntegrationOperationList,
  projectIntegrationOperationReplay
} from '../server/utils/integrationOperationDiagnosticProjection'

const sensitive = [
  'operationKey', 'correlationKey', 'idempotencyKey', 'commandSchemaVersion', 'commandSha256',
  'requiredCapability', 'lockedBy', 'lockedUntil', 'fencingToken', 'lastErrorSummary',
  'command', 'request', 'response', 'authorization', 'token'
]

test('integration operation list projection is an allow-list at the browser boundary', () => {
  const response = projectIntegrationOperationList({
    items: [{
      operationId: '550e8400-e29b-41d4-a716-446655440000', targetApp: 'altoc', operationCode: 'aims.delivery.sync.v1',
      sourceBizType: 'work_item', sourceBizCode: 'WI-1', targetBizType: 'service_ticket', targetBizCode: 'ST-1',
      status: 'dead_letter', attemptCount: 4, maxAttempts: 4, version: 7,
      lastErrorCode: 'remote_timeout', lastErrorClass: 'retryable', updatedAt: '2026-07-11T00:00:00Z',
      operationKey: 'secret-operation-key', correlationKey: 'secret-correlation', idempotencyKey: 'secret-idempotency',
      commandSchemaVersion: 'v1', commandSha256: 'hash', requiredCapability: 'altoc:secret:write',
      lockedBy: 'worker', lockedUntil: '2026-07-11T01:00:00Z', fencingToken: 99,
      lastErrorSummary: 'raw upstream body', command: { secret: true }, request: { authorization: 'Bearer secret' },
      response: { token: 'secret' }
    }],
    nextCursor: 'opaque-cursor'
  })

  assert.deepEqual(response, {
    items: [{
      operationId: '550e8400-e29b-41d4-a716-446655440000', targetApp: 'altoc', operationCode: 'aims.delivery.sync.v1',
      sourceBizType: 'work_item', sourceBizCode: 'WI-1', targetBizType: 'service_ticket', targetBizCode: 'ST-1',
      status: 'dead_letter', attemptCount: 4, maxAttempts: 4, version: 7,
      lastErrorCode: 'remote_timeout', lastErrorClass: 'retryable', updatedAt: '2026-07-11T00:00:00Z'
    }],
    nextCursor: 'opaque-cursor'
  })
  const serialized = JSON.stringify(response)
  for (const key of sensitive) assert.doesNotMatch(serialized, new RegExp(key, 'i'))
})

test('attempt projection has no request, response, identity or raw error evidence', () => {
  const response = projectIntegrationOperationAttempts({
    operationId: '550e8400-e29b-41d4-a716-446655440000',
    items: [{
      attemptId: 'secret-attempt-id', operationId: '550e8400-e29b-41d4-a716-446655440000', operationCode: 'aims.delivery.sync.v1',
      attemptNo: 4, triggerType: 'tenant_gateway', resultStatus: 'failed', httpStatus: 503,
      errorCode: 'remote_timeout', errorClass: 'retryable', targetBizType: 'service_ticket', targetBizCode: 'ST-1',
      startedAt: '2026-07-11T00:00:00Z', finishedAt: '2026-07-11T00:00:02Z', durationMs: 2000,
      correlationKey: 'secret', request: { body: 'secret' }, response: { body: 'secret' }, authorization: 'secret'
    }]
  })

  assert.deepEqual(response, {
    operationId: '550e8400-e29b-41d4-a716-446655440000',
    items: [{
      operationId: '550e8400-e29b-41d4-a716-446655440000', operationCode: 'aims.delivery.sync.v1', attemptNo: 4,
      status: 'failed', errorCode: 'remote_timeout', errorClass: 'retryable', targetBizType: 'service_ticket',
      targetBizCode: 'ST-1', startedAt: '2026-07-11T00:00:00Z', finishedAt: '2026-07-11T00:00:02Z', durationMs: 2000
    }]
  })
  const serialized = JSON.stringify(response)
  for (const key of [...sensitive, 'attemptId', 'triggerType', 'httpStatus']) assert.doesNotMatch(serialized, new RegExp(key, 'i'))
})

test('replay acknowledgement is fixed to its browser request tuple', () => {
  assert.deepEqual(projectIntegrationOperationReplay('550e8400-e29b-41d4-a716-446655440000', 7, 'operator reviewed'), {
    operationId: '550e8400-e29b-41d4-a716-446655440000', expectedVersion: 7, reason: 'operator reviewed'
  })
})

test('malformed runtime payload fails closed rather than leaking a partial object', () => {
  assert.throws(() => projectIntegrationOperationList({ items: [{ operationId: 'x' }], nextCursor: null }))
  assert.throws(() => projectIntegrationOperationAttempts({ operationId: 'x', items: [{}] }))
  assert.throws(() => projectIntegrationOperationAttempts({
    operationId: 'x',
    items: [{ operationId: 'other', operationCode: 'code', attemptNo: 1, resultStatus: 'failed' }]
  }))
})

test('shared diagnostic page never binds a sensitive runtime field', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const component = readFileSync(`${root}/app/components/IntegrationOperationAdminPage.vue`, 'utf8')
  for (const field of ['operationKey', 'lastErrorSummary', 'triggerType', 'httpStatus', 'attemptId']) {
    assert.doesNotMatch(component, new RegExp(field, 'i'))
  }
})

test('shared diagnostic status selector uses a non-empty all sentinel', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const component = readFileSync(`${root}/app/components/IntegrationOperationAdminPage.vue`, 'utf8')
  assert.match(component, /\{ label: '全部状态', value: 'all' \}/)
  assert.match(component, /status\.value === 'all' \? undefined : status\.value/)
  assert.doesNotMatch(component, /label: '全部状态', value: ''/)
})

test('shared diagnostic page accepts an app-specific API base without changing the safe default', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const component = readFileSync(`${root}/app/components/IntegrationOperationAdminPage.vue`, 'utf8')
  assert.match(component, /apiBase\?: string/)
  assert.match(component, /apiBase \|\| '\/api\/v1\/integration-operations'/)
  assert.match(component, /`\$\{operationApiBase\}\/\$\{encodeURIComponent\(row\.operationId\)\}\/attempts`/)
  assert.match(component, /`\$\{operationApiBase\}\/\$\{encodeURIComponent\(selected\.value\.operationId\)\}\/replay`/)
})
