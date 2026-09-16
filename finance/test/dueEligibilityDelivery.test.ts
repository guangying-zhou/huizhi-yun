import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runDueEligibilityDelivery } from '../server/utils/dueEligibilityDelivery.ts'

test('allowed Finance recipient closes old owner before eligibility, send, and ack', async () => {
  const events: string[] = []
  const result = await runDueEligibilityDelivery({
    closePreviousRecipient: async () => { events.push('old-owner-closure') },
    checkEligibility: async () => {
      events.push('eligibility:invoice_issuance_due')
      return { active: true, allowed: true, reason: 'allowed' }
    },
    deliver: async () => {
      events.push('send')
      events.push('ack')
      return 'notification-1'
    }
  })

  assert.equal(result, 'notification-1')
  assert.deepEqual(events, ['old-owner-closure', 'eligibility:invoice_issuance_due', 'send', 'ack'])
})

test('inactive or denied Finance recipient is retryable without send or ack', async () => {
  for (const eligibility of [
    { active: false, allowed: false, reason: 'subject_inactive' },
    { active: true, allowed: false, reason: 'permission_denied' }
  ]) {
    const events: string[] = []
    await assert.rejects(runDueEligibilityDelivery({
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

test('Finance eligibility 503 propagates without send or ack after old owner closure', async () => {
  const events: string[] = []
  const unavailable = Object.assign(new Error('subject eligibility unavailable'), { statusCode: 503 })
  await assert.rejects(runDueEligibilityDelivery({
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

test('Finance drain passes the real stream purpose and feature flag short-circuits first', () => {
  const source = readFileSync(new URL('../server/utils/dueNotificationDrain.ts', import.meta.url), 'utf8')
  assert.match(source, /checkSubjectEligibility\(\{[\s\S]{0,160}subjectUid:\s*recipientUid,[\s\S]{0,80}purpose:\s*candidate\.stream/)
  assert.match(source, /\['invoice_issuance_due', 'receipt_reconciliation_due'\]/)
  assert.ok(source.indexOf('if (!isFinanceDueNotificationDeliveryEnabled())') < source.indexOf('requireFinanceDueNotificationRuntimeBinding()'))
  assert.ok(source.indexOf('requireFinanceDueNotificationRuntimeBinding()') < source.indexOf('const eligibilityEvent ='))
})
