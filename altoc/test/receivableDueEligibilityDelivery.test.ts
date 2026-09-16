import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runReceivableDueEligibilityDelivery } from '../server/utils/receivableDueEligibilityDelivery.ts'

test('allowed Altoc recipient closes old owner before eligibility, send, and ack', async () => {
  const events: string[] = []
  const result = await runReceivableDueEligibilityDelivery({
    closePreviousRecipient: async () => { events.push('old-owner-closure') },
    checkEligibility: async () => {
      events.push('eligibility:receivable_plan_due')
      return { active: true, allowed: true, reason: 'allowed' }
    },
    deliver: async () => {
      events.push('send')
      events.push('ack')
      return 'notification-1'
    }
  })

  assert.equal(result, 'notification-1')
  assert.deepEqual(events, ['old-owner-closure', 'eligibility:receivable_plan_due', 'send', 'ack'])
})

test('inactive or denied Altoc recipient is retryable without send or ack', async () => {
  for (const eligibility of [
    { active: false, allowed: false, reason: 'subject_inactive' },
    { active: true, allowed: false, reason: 'permission_denied' }
  ]) {
    const events: string[] = []
    await assert.rejects(runReceivableDueEligibilityDelivery({
      closePreviousRecipient: async () => { events.push('old-owner-closure') },
      checkEligibility: async () => {
        events.push('eligibility')
        return eligibility
      },
      deliver: async () => {
        events.push('send')
        events.push('ack')
      }
    }), new RegExp(`subject_eligibility_rejected:${eligibility.reason}`))
    assert.deepEqual(events, ['old-owner-closure', 'eligibility'])
  }
})

test('Altoc eligibility 503 propagates without send or ack after old owner closure', async () => {
  const events: string[] = []
  const unavailable = Object.assign(new Error('subject eligibility unavailable'), { statusCode: 503 })
  await assert.rejects(runReceivableDueEligibilityDelivery({
    closePreviousRecipient: async () => { events.push('old-owner-closure') },
    checkEligibility: async () => {
      events.push('eligibility')
      throw unavailable
    },
    deliver: async () => {
      events.push('send')
      events.push('ack')
    }
  }), error => error === unavailable)
  assert.deepEqual(events, ['old-owner-closure', 'eligibility'])
})

test('Altoc drain passes receivable_plan_due purpose and feature flag short-circuits first', () => {
  const source = readFileSync(new URL('../server/utils/receivableDueNotificationDrain.ts', import.meta.url), 'utf8')
  assert.match(source, /checkSubjectEligibility\(\{[\s\S]{0,160}subjectUid:\s*recipientUid,[\s\S]{0,80}purpose:\s*candidate\.stream/)
  assert.match(source, /stream:\s*'receivable_plan_due'/)
  assert.ok(source.indexOf('if (!isAltocReceivableDueEnabled())') < source.indexOf('requireAltocReceivableDueRuntimeBinding()'))
  assert.ok(source.indexOf('requireAltocReceivableDueRuntimeBinding()') < source.indexOf('const eligibilityEvent ='))
})
