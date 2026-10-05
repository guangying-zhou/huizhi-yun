import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  integrationOperationActionableMetadata,
  integrationOperationActionUrl,
  validateIntegrationOperationFailureNotificationInput
} from '../server/utils/integrationOperationFailureNotificationContract.ts'
import { canonicalizePortalNotificationRequest } from '../server/utils/portalNotificationIdempotency.ts'

const actor = {
  actorType: 'service' as const,
  actorId: 'aims.runtime',
  appCode: 'aims',
  tenantCode: 'tenant-1',
  deploymentCode: 'tenant-1-aims'
}

function validInput() {
  return {
    tenantCode: 'tenant-1', deploymentCode: 'tenant-1-aims', sourceApp: 'aims', targetApp: 'altoc',
    operationId: '90b90bf3-5899-4aed-98c8-23dd1897f463',
    operationCode: 'aims.service-ticket.delivery-result.sync.v1', sourceBizType: 'service_ticket', sourceBizCode: 'T-1',
    attemptCount: 8, maxAttempts: 8, lastErrorCode: 'upstream_timeout', lastErrorClass: 'transient',
    deadLetteredAt: '2026-07-10T12:00:00Z', originalActorUid: 'U001',
    generation: 2, operationVersion: 17,
    actionableKey: 'aims:integration-operation:90b90bf3-5899-4aed-98c8-23dd1897f463:g2',
    objectVersion: 'dead-letter:g2:v17'
  }
}

describe('integration operation dead-letter notifications', () => {
  test('binds source, tenant and deployment to verified service claims', () => {
    assert.equal(validateIntegrationOperationFailureNotificationInput(validInput(), actor).sourceApp, 'aims')
    assert.throws(() => validateIntegrationOperationFailureNotificationInput({ ...validInput(), sourceApp: 'altoc' }, actor))
    assert.throws(() => validateIntegrationOperationFailureNotificationInput({ ...validInput(), tenantCode: 'tenant-2' }, actor))
    assert.throws(() => validateIntegrationOperationFailureNotificationInput({ ...validInput(), deploymentCode: 'tenant-2-aims' }, actor))
  })

  test('accepts only the explicitly supported additional source runtimes', () => {
    for (const sourceApp of ['assets', 'finance', 'people'] as const) {
      const sourceActor = { ...actor, appCode: sourceApp, actorId: `${sourceApp}.runtime` }
      const input = {
        ...validInput(), sourceApp, targetApp: 'altoc',
        operationCode: `${sourceApp}.integration-operation.test.v1`,
        actionableKey: `${sourceApp}:integration-operation:90b90bf3-5899-4aed-98c8-23dd1897f463:g2`
      }
      assert.equal(validateIntegrationOperationFailureNotificationInput(input, sourceActor).sourceApp, sourceApp)
    }
    assert.throws(() => validateIntegrationOperationFailureNotificationInput({ ...validInput(), sourceApp: 'codocs' }, { ...actor, appCode: 'codocs' }))
  })

  test('rejects command, digest, response, token, URL and arbitrary metadata fields', () => {
    for (const field of ['operationKey', 'command', 'commandJson', 'commandSha256', 'responseSummarySha256', 'lastErrorSummary', 'token', 'url', 'metadata']) {
      assert.throws(() => validateIntegrationOperationFailureNotificationInput({ ...validInput(), [field]: 'secret' }, actor))
    }
  })

  test('route authenticates before reading or publishing the payload', () => {
    const content = readFileSync(new URL('../server/api/v1/console/notifications/integration-operation-dead-letter.post.ts', import.meta.url), 'utf8')
    const auth = content.indexOf('requireConsoleServiceActor(event, \'notifications\', \'notifications:publish\')')
    assert.ok(auth >= 0)
    assert.ok(auth < content.indexOf('readBody(event)'))
    assert.ok(auth < content.indexOf('notifyIntegrationOperationDeadLetter(event, body, actor)'))
  })

  test('uses stable portal idempotency and safe metadata projection', () => {
    const content = readFileSync(new URL('../server/utils/integrationOperationFailureNotifications.ts', import.meta.url), 'utf8')
    const contract = readFileSync(new URL('../server/utils/integrationOperationFailureNotificationContract.ts', import.meta.url), 'utf8')
    assert.match(content, /createHash\('sha256'\)/)
    assert.match(content, /idempotencyKey: notificationIdempotencyKey\(input\)/)
    assert.match(contract, /actionableState: 'pending'/)
    assert.match(contract, /actionableKey: input\.actionableKey/)
    assert.match(contract, /targetAppCode: input\.sourceApp/)
    assert.match(contract, /authorizationDescriptor: \{ resource: 'integration_operation', id: input\.operationId \}/)
    assert.match(content, /actionTargetCatalogBinding: NOTIFICATION_ACTION_TARGET_CATALOG_BINDING/)
    assert.doesNotMatch(content, /operationKey: input\.operationKey/)
    assert.doesNotMatch(content, /metadata:\s*\{[^}]*commandSha256/s)
    assert.doesNotMatch(content, /metadata:\s*\{[^}]*responseSummarySha256/s)
    assert.doesNotMatch(content, /metadata:\s*\{[^}]*lastErrorSummary/s)
  })

  test('requires the complete source-frozen actionable identity when any identity field is present', () => {
    const validated = validateIntegrationOperationFailureNotificationInput(validInput(), actor)
    assert.equal(validated.actionableKey, validInput().actionableKey)
    assert.equal(validated.objectVersion, validInput().objectVersion)
    assert.equal(validated.generation, 2)
    for (const field of ['generation', 'operationVersion', 'actionableKey', 'objectVersion']) {
      const input = { ...validInput(), [field]: undefined }
      assert.throws(() => validateIntegrationOperationFailureNotificationInput(input, actor))
    }
  })

  test('legacy payload stays a non-actionable notification and partial frozen identity is rejected', () => {
    const legacy = {
      ...validInput(),
      generation: undefined,
      operationVersion: undefined,
      actionableKey: undefined,
      objectVersion: undefined
    }
    const validated = validateIntegrationOperationFailureNotificationInput(legacy, actor)
    assert.deepEqual(integrationOperationActionableMetadata(validated), {})
    const canonical = canonicalizePortalNotificationRequest({
      sourceAppCode: 'aims', title: 'legacy dead letter', idempotencyKey: 'legacy-1', recipients: ['U001'],
      actionUrl: '/integration-operations?operationId=op-1', bizType: 'integration_operation',
      bizId: validated.operationId, metadata: integrationOperationActionableMetadata(validated)
    }, { appCode: 'aims' })
    assert.equal(canonical.actionable, null)
  })

  test('resolves the signed action target before any notification delivery', () => {
    const content = readFileSync(new URL('../server/utils/integrationOperationFailureNotifications.ts', import.meta.url), 'utf8')
    const resolveIndex = content.indexOf('(dependencies.resolveActionUrl || resolveRegisteredNotificationActionTarget)')
    const deliverIndex = content.indexOf('(dependencies.deliver || deliverLifecycleFailureNotification)')
    assert.ok(resolveIndex >= 0)
    assert.ok(deliverIndex > resolveIndex)
  })

  test('links each dead letter to its source application diagnostics', () => {
    assert.equal(
      integrationOperationActionUrl({ sourceApp: 'aims', operationId: 'op-1' }, 'https://tenant.example/aims'),
      'https://tenant.example/aims/integration-operations?status=dead_letter&operationId=op-1'
    )
    assert.equal(
      integrationOperationActionUrl({ sourceApp: 'altoc', operationId: 'op-2' }, 'https://tenant.example/altoc/'),
      'https://tenant.example/altoc/admin/integration-operations?status=dead_letter&operationId=op-2'
    )
    assert.equal(
      integrationOperationActionUrl({ sourceApp: 'assets', operationId: 'op-3' }, 'https://tenant.example/assets/'),
      'https://tenant.example/assets/integration-operations?status=dead_letter&operationId=op-3'
    )
    assert.equal(
      integrationOperationActionUrl({ sourceApp: 'finance', operationId: 'op-4' }, 'https://tenant.example/finance/'),
      'https://tenant.example/finance/integration-operations?status=dead_letter&operationId=op-4'
    )
    assert.equal(
      integrationOperationActionUrl({ sourceApp: 'people', operationId: 'op-5' }, 'https://tenant.example/people/'),
      'https://tenant.example/people/integration-operations?status=dead_letter&operationId=op-5'
    )
  })
})
