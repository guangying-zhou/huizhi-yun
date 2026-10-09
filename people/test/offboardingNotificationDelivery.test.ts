import assert from 'node:assert/strict'
import test from 'node:test'
import type { H3Event } from 'h3'
import {
  deliverPeopleOffboardingNotificationCandidate,
  PeopleOffboardingNotificationDeliveryError,
  type PeopleOffboardingNotificationDeliveryDependencies
} from '../server/utils/offboardingNotificationDelivery.ts'
import type { PeopleOffboardingCandidate } from '../server/utils/offboardingNotificationPolicy.ts'

const event = { context: {} } as H3Event

function candidate(
  stream: PeopleOffboardingCandidate['stream'] = 'offboarding_handover_due'
): PeopleOffboardingCandidate {
  return {
    stream,
    phase: 'D7',
    sourceType: 'offboarding_task',
    sourceId: 42,
    sourceCode: 'OBT-42',
    sourceName: '研发交接',
    caseCode: 'OBC-7',
    taskCode: 'OBT-42',
    taskType: stream === 'offboarding_handover_due' ? 'handover' : 'asset_recovery_coordination',
    dueAt: '2026-07-17T12:00:00Z',
    recipientCandidates: ['owner-42'],
    eventVersion: `people-offboarding:${stream}:v2`,
    previousEventVersion: `people-offboarding:${stream}:v1`,
    previousRecipientUid: 'owner-old',
    idempotencyKey: `people-offboarding:${stream}:key`,
    actionableKey: `people:offboarding:${stream}:42`
  }
}

function dependencies(overrides: Partial<PeopleOffboardingNotificationDeliveryDependencies> = {}) {
  const calls: string[] = []
  const value: PeopleOffboardingNotificationDeliveryDependencies = {
    resolveActiveDirectRecipient: async (item) => {
      const uid = item.recipientCandidates[0]
      calls.push(`directory:${uid}`)
      return uid || null
    },
    closePreviousRecipient: async ({ recipientUid }) => {
      calls.push(`close:${recipientUid}`)
    },
    checkEligibility: async ({ event: receivedEvent, subjectUid, purpose }) => {
      assert.equal(receivedEvent, event)
      calls.push(`eligibility:${subjectUid}:${purpose}`)
      return { active: true, allowed: true, reason: 'allowed' }
    },
    send: async (recipientUid) => {
      calls.push(`send:${recipientUid}`)
      return { inApp: { value: { notificationId: 'notification-42' } } }
    },
    acknowledge: async (notificationId, recipientUid) => {
      calls.push(`ack:${notificationId}:${recipientUid}`)
    },
    ...overrides
  }
  return { calls, value }
}

test('People checks the real stream eligibility after active recipient and old-owner closure, before send and ack', async () => {
  for (const stream of [
    'offboarding_handover_due',
    'offboarding_asset_recovery_due'
  ] as const) {
    const { calls, value } = dependencies()
    await deliverPeopleOffboardingNotificationCandidate({ event, candidate: candidate(stream), dependencies: value })
    assert.deepEqual(calls, [
      'directory:owner-42',
      'close:owner-old',
      `eligibility:owner-42:${stream}`,
      'send:owner-42',
      'ack:notification-42:owner-42'
    ])
  }
})

test('People keeps inactive and permission-denied recipients retryable without send or ack', async () => {
  for (const decision of [
    { active: false, allowed: false, reason: 'subject_inactive' },
    { active: true, allowed: false, reason: 'permission_denied' }
  ]) {
    let sends = 0
    let acknowledgements = 0
    const { value } = dependencies({
      checkEligibility: async () => decision,
      send: async () => {
        sends += 1
        return { inApp: { value: { notificationId: 'unexpected' } } }
      },
      acknowledge: async () => { acknowledgements += 1 }
    })
    await assert.rejects(
      deliverPeopleOffboardingNotificationCandidate({ event, candidate: candidate(), dependencies: value }),
      (error: unknown) => error instanceof PeopleOffboardingNotificationDeliveryError
        && error.code === 'people_offboarding_notification_recipient_ineligible'
        && error.retryable
    )
    assert.equal(sends, 0)
    assert.equal(acknowledgements, 0)
  }
})

test('People keeps eligibility 503 retryable without send or ack', async () => {
  let sends = 0
  let acknowledgements = 0
  const unavailable = Object.assign(new Error('subject_eligibility_policy_unavailable'), { statusCode: 503 })
  const { value } = dependencies({
    checkEligibility: async () => { throw unavailable },
    send: async () => {
      sends += 1
      return { inApp: { value: { notificationId: 'unexpected' } } }
    },
    acknowledge: async () => { acknowledgements += 1 }
  })
  await assert.rejects(
    deliverPeopleOffboardingNotificationCandidate({ event, candidate: candidate(), dependencies: value }),
    (error: unknown) => error instanceof PeopleOffboardingNotificationDeliveryError
      && error.code === 'people_offboarding_notification_eligibility_unavailable'
      && error.retryable
      && error.cause === unavailable
  )
  assert.equal(sends, 0)
  assert.equal(acknowledgements, 0)
})
