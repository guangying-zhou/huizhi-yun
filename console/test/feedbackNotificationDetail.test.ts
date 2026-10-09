import test from 'node:test'
import assert from 'node:assert/strict'
import type { H3Event } from 'h3'
import { feedbackNotificationDetailAuthorization } from '../server/utils/feedbackNotificationDetail'

test('feedback detail checks the signed live revision before recipient eligibility without policy sync', async () => {
  const event = {} as H3Event
  const calls: string[] = []
  const dependencies = {
    revisionGate: async <T>(_event: H3Event, tenant: string, evaluate: () => Promise<T>) => {
      assert.equal(tenant, 'fixture-tenant')
      calls.push('revision')
      return evaluate()
    },
    eligible: async (_event: H3Event, uid: string) => {
      assert.equal(uid, 'fixture-recipient')
      calls.push('eligibility')
      return true
    }
  }
  assert.deepEqual(await feedbackNotificationDetailAuthorization(event, 'fixture-tenant', 'fixture-recipient', 'fixture-id', dependencies), { authorized: true, resource: 'feedback', id: 'fixture-id' })
  assert.deepEqual(calls, ['revision', 'eligibility'])
  dependencies.eligible = async () => false
  assert.equal((await feedbackNotificationDetailAuthorization(event, 'fixture-tenant', 'fixture-recipient', 'fixture-id', dependencies)).authorized, false)
  dependencies.revisionGate = async () => {
    throw new Error('policy_revision_unavailable')
  }
  await assert.rejects(feedbackNotificationDetailAuthorization(event, 'fixture-tenant', 'fixture-recipient', 'fixture-id', dependencies), /policy_revision_unavailable/)
})
