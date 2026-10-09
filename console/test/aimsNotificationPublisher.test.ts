import test from 'node:test'
import assert from 'node:assert/strict'
import { bindAimsNotificationPublisher } from '../server/utils/aimsNotificationPublisher'

test('registered physical Host retains only the Aims notification owning namespace', () => {
  const actor = { appCode: 'enterprise', actorId: 'enterprise.runtime' }
  const mapped = bindAimsNotificationPublisher(actor, { sourceAppCode: 'aims' })
  assert.equal(mapped.notificationSourceApp, 'aims')
  assert.equal(mapped.appCode, 'enterprise')
  assert.equal(mapped.actorId, 'enterprise.runtime')
  assert.equal(bindAimsNotificationPublisher(actor, { sourceAppCode: 'people' }), actor)
  assert.throws(() => bindAimsNotificationPublisher({ ...actor, actorId: 'aims.runtime' }, { sourceAppCode: 'aims' }))
  const legacy = { appCode: 'aims', actorId: 'aims.runtime' }
  assert.equal(bindAimsNotificationPublisher(legacy, { sourceAppCode: 'aims' }), legacy)
})

test('Host owning namespace is consumed by canonicalization without changing physical audit identity', async () => {
  const { canonicalizePortalNotificationRequest } = await import('../server/utils/portalNotificationIdempotency')
  const input = { sourceAppCode: 'aims', title: 'fixture', idempotencyKey: 'aims:fixture:original', recipients: ['fixture-user'], channels: ['in_app'] }
  const physical = { appCode: 'enterprise', actorId: 'enterprise.runtime' }
  const result = canonicalizePortalNotificationRequest(input, bindAimsNotificationPublisher(physical, input))
  assert.equal(result.sourceAppCode, 'aims')
  assert.equal(result.createdBy, 'enterprise.runtime')
  assert.equal(result.idempotencyKey, 'aims:fixture:original')
  assert.throws(() => canonicalizePortalNotificationRequest(input, physical))
  assert.throws(() => canonicalizePortalNotificationRequest({ ...input, sourceAppCode: 'people' }, bindAimsNotificationPublisher(physical, input)))
})
