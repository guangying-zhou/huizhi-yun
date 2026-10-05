import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  canonicalizePortalNotificationRequest,
  PortalNotificationPublishError,
  type PublishPortalNotificationInput
} from '../server/utils/portalNotificationIdempotency.ts'

const actor = { actorId: 'workflow-client', appCode: 'workflow' }

function request(overrides: PublishPortalNotificationInput = {}): PublishPortalNotificationInput {
  return {
    sourceAppCode: 'workflow',
    eventType: 'workflow.task.created',
    category: 'approval',
    severity: 'info',
    title: 'Approval required',
    summary: 'Please review task 1',
    body: 'Body',
    actionUrl: 'https://example.test/tasks/1',
    bizType: 'workflow_task',
    bizId: '1',
    idempotencyKey: 'workflow:task:1:created',
    recipients: ['u2', 'u1', 'u2'],
    channels: ['wecom', 'in_app'],
    metadata: {
      z: 1,
      nested: { b: true, a: 'value' },
      actionableKey: 'workflow:tasks:sha256:generation-1',
      eventVersion: 'flow_tasks:sha256:generation-1',
      bizKey: 'workflow:instance:1',
      targetAppCode: 'aims',
      actionTargetAppCode: 'aims',
      actionTargetCatalogBinding: 'catalog-v1'
    },
    ...overrides
  }
}

test('canonical notification hash ignores set and object-key order', () => {
  const first = canonicalizePortalNotificationRequest(request(), actor)
  const second = canonicalizePortalNotificationRequest(request({
    recipients: 'u1|u2',
    channels: ['in_app', 'wecom', 'in_app'],
    metadata: {
      actionTargetAppCode: 'aims',
      actionTargetCatalogBinding: 'catalog-v1',
      actionableKey: 'workflow:tasks:sha256:generation-1',
      bizKey: 'workflow:instance:1',
      eventVersion: 'flow_tasks:sha256:generation-1',
      nested: { a: 'value', b: true },
      targetAppCode: 'aims',
      z: 1
    }
  }), actor)
  assert.equal(first.requestHash, second.requestHash)
  assert.deepEqual(first.recipients, ['u1', 'u2'])
  assert.deepEqual(first.channels, ['in_app', 'wecom'])
})

test('canonical hash binds delivery semantics and actionable predecessor', () => {
  const original = canonicalizePortalNotificationRequest(request(), actor)
  for (const variant of [
    request({ recipients: ['u1', 'u3'] }),
    request({ channels: ['in_app'] }),
    request({ title: 'Changed' }),
    request({ actionUrl: 'https://example.test/tasks/2' }),
    request({ metadata: { ...(request().metadata as Record<string, unknown>), previousObjectVersion: 'v0' } })
  ]) {
    assert.notEqual(canonicalizePortalNotificationRequest(variant, actor).requestHash, original.requestHash)
  }
  const { actionable, metadataJson: _metadataJson, createdBy: _createdBy, requestHash, ...hashFields } = original
  assert.ok(actionable)
  assert.equal(requestHash, createHash('sha256').update(JSON.stringify(hashFields)).digest('hex'))
})

test('source identity and recipient rules fail closed before Runtime', () => {
  assert.throws(
    () => canonicalizePortalNotificationRequest(request({ sourceAppCode: 'aims' }), actor),
    (error: unknown) => error instanceof PortalNotificationPublishError
      && error.statusCode === 403
      && error.code === 'source_app_mismatch'
  )
  assert.throws(
    () => canonicalizePortalNotificationRequest(request({ recipients: ['@all'] }), actor),
    (error: unknown) => error instanceof PortalNotificationPublishError
      && error.code === 'invalid_recipients'
  )
})

test('Enterprise Host business notification keeps its service source and Codocs attribution', () => {
  const hostActor = { actorId: 'enterprise.runtime', appCode: 'enterprise' }
  const hostRequest = request({
    sourceAppCode: 'enterprise',
    eventType: 'codocs.document.shared',
    metadata: { notificationKind: 'business_event', moduleAppCode: 'codocs' }
  })
  const canonical = canonicalizePortalNotificationRequest(hostRequest, hostActor)
  assert.equal(canonical.sourceAppCode, 'enterprise')
  assert.equal(canonical.metadata.moduleAppCode, 'codocs')
  assert.equal(canonical.actionable, null)
  assert.throws(
    () => canonicalizePortalNotificationRequest({ ...hostRequest, sourceAppCode: 'codocs' }, hostActor),
    (error: unknown) => error instanceof PortalNotificationPublishError
      && error.statusCode === 403
      && error.code === 'source_app_mismatch'
  )
})

test('Runtime owns canonical idempotency, replay and immutable persistence', () => {
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications_write.go', import.meta.url), 'utf8')
  const consoleSource = readFileSync(new URL('../server/utils/portalNotificationIdempotency.ts', import.meta.url), 'utf8')
  assert.match(runtime, /SELECT notification_id,request_hash/)
  assert.match(runtime, /idempotency_payload_mismatch/)
  assert.match(runtime, /INSERT INTO portal_notifications/)
  assert.match(runtime, /INSERT INTO portal_notification_recipients/)
  assert.doesNotMatch(consoleSource, /SELECT |INSERT INTO|UPDATE |mysql2|queryRow|execute/)
})
