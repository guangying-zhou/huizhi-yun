import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  aimsDueNotificationsEnabled,
  aimsDueRecipientTransition,
  resolveAimsDueRecipient,
  type AimsDueCandidate
} from '../server/utils/dueNotificationPolicy.ts'
import {
  AimsDueEligibilityError,
  runAimsDueEligibilityGate
} from '../server/utils/dueNotificationEligibility.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidate: AimsDueCandidate = {
  stream: 'response_due', phase: 'T-1h', workItemId: 7, projectId: 3,
  projectCode: 'PRJ-3', projectName: 'Delivery', itemKey: 'PRJ-3-7', title: 'Respond',
  status: 'todo', priority: 'P0', assigneeUid: 'inactive-user', projectLeaderUid: 'leader',
  deptCode: 'DELIVERY', dueAt: '2026-07-10T13:00:00Z', eventVersion: 'v1:test',
  idempotencyKey: 'aims-due:test', actionableKey: 'aims:work-item:7:response_due'
}

test('due notification delivery feature flag is closed by default', () => {
  assert.equal(aimsDueNotificationsEnabled(undefined), false)
  assert.equal(aimsDueNotificationsEnabled('false'), false)
  assert.equal(aimsDueNotificationsEnabled('true'), true)
})

test('recipient uses only explicit-active runtime-proven assignee or project leader', async () => {
  const calls: string[] = []
  const leader = await resolveAimsDueRecipient(candidate, {
    findActiveUser: async (uid) => {
      calls.push(uid)
      return uid === 'leader' ? { uid, status: 1 } : null
    }
  })
  assert.equal(leader, 'leader')
  assert.deepEqual(calls, ['inactive-user', 'leader'])

  const noDepartmentFallback = await resolveAimsDueRecipient({ ...candidate, assigneeUid: null, projectLeaderUid: '@all' }, {
    findActiveUser: async () => ({ uid: 'manager', status: 'active' })
  })
  assert.equal(noDepartmentFallback, null)

  const missingStatus = await resolveAimsDueRecipient({ ...candidate, projectLeaderUid: null }, {
    findActiveUser: async uid => ({ uid })
  })
  assert.equal(missingStatus, null)
})

test('Directory fallback recipient change closes the old UID and starts the new UID without predecessor CAS', async () => {
  const transitioned = {
    ...candidate,
    previousEventVersion: 'v0:delivered',
    previousRecipientUid: 'inactive-user'
  }
  const firstRecipient = await resolveAimsDueRecipient(transitioned, {
    findActiveUser: async uid => ({ uid, status: 1 })
  })
  const fallbackRecipient = await resolveAimsDueRecipient(transitioned, {
    findActiveUser: async uid => uid === 'leader' ? { uid, status: 'active' } : null
  })
  assert.equal(firstRecipient, 'inactive-user')
  assert.equal(fallbackRecipient, 'leader')
  assert.deepEqual(aimsDueRecipientTransition(transitioned, fallbackRecipient || ''), {
    previousObjectVersion: null,
    previousRecipientClosure: {
      expectedVersion: 'v0:delivered',
      recipientUid: 'inactive-user'
    }
  })
})

test('same UID supersession keeps predecessor and owner-move replay remains deterministic', () => {
  const delivered = {
    ...candidate,
    previousEventVersion: 'v0:delivered',
    previousRecipientUid: 'leader'
  }
  assert.deepEqual(aimsDueRecipientTransition(delivered, 'leader'), {
    previousObjectVersion: 'v0:delivered',
    previousRecipientClosure: null
  })
  const firstAttempt = aimsDueRecipientTransition(delivered, 'replacement')
  const ackLossReplay = aimsDueRecipientTransition(delivered, 'replacement')
  assert.deepEqual(ackLossReplay, firstAttempt)
  assert.deepEqual(ackLossReplay, {
    previousObjectVersion: null,
    previousRecipientClosure: {
      expectedVersion: 'v0:delivered',
      recipientUid: 'leader'
    }
  })
})

function eligibilityGate(input: {
  eligibility?: { active: boolean, allowed: boolean }
  eligibilityError?: Error
  closePreviousRecipient?: boolean
  events: string[]
}) {
  return runAimsDueEligibilityGate({
    purpose: candidate.stream,
    closePreviousRecipient: input.closePreviousRecipient ? async () => { input.events.push('close') } : undefined,
    checkEligibility: async (purpose: string) => {
      input.events.push(`eligibility:${purpose}`)
      if (input.eligibilityError) throw input.eligibilityError
      return input.eligibility || { active: true, allowed: true }
    },
    deliver: async () => {
      input.events.push('send')
      input.events.push('ack')
    }
  })
}

test('eligibility gates publish/ack and uses the exact Aims stream purpose', async () => {
  const eligibleEvents: string[] = []
  await eligibilityGate({ events: eligibleEvents })
  assert.deepEqual(eligibleEvents, ['eligibility:response_due', 'send', 'ack'])

  for (const eligibility of [{ active: false, allowed: false }, { active: true, allowed: false }]) {
    const events: string[] = []
    await assert.rejects(
      eligibilityGate({ events, eligibility }),
      (error: unknown) => error instanceof AimsDueEligibilityError
        && error.code === 'aims_due_recipient_ineligible'
        && error.retryable
    )
    assert.deepEqual(events, ['eligibility:response_due'])
  }
})

test('eligibility 503 stays retryable without publish/ack and owner move closure happens first', async () => {
  const events: string[] = []
  await assert.rejects(
    eligibilityGate({
      events,
      closePreviousRecipient: true,
      eligibilityError: Object.assign(new Error('upstream unavailable'), { statusCode: 503 })
    }),
    (error: unknown) => error instanceof AimsDueEligibilityError
      && error.code === 'aims_due_eligibility_unavailable'
      && error.retryable
  )
  assert.deepEqual(events, ['close', 'eligibility:response_due'])
})

test('Cloudflare scheduled notification source is frozen, bounded, server-owned and opt-in', () => {
  const drain = readFileSync(`${root}/server/utils/dueNotificationDrain.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/notifications/due.ts`, 'utf8')
  const config = readFileSync(`${root}/nuxt.config.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  const foundationNotifications = readFileSync(`${root}/../foundation/server/utils/notifications.ts`, 'utf8')
  assert.match(task, /name:\s*'notifications:due'/)
  assert.match(config, /'\*\/15 \* \* \* \*': \['notifications:due'\]/)
  assert.match(render, /HZY_AIMS_DUE_NOTIFICATIONS_ENABLED/)
  assert.match(drain, /const asOf = new Date\(\)\.toISOString\(\)/)
  assert.match(drain, /stream, asOf, cursor:/)
  assert.match(drain, /response_due.*resolution_due.*work_item_due/s)
  assert.match(drain, /sendNotification\s*\(/)
  assert.match(drain, /checkSubjectEligibility\(\{ event, subjectUid: recipientUid, purpose \}\)/)
  assert.doesNotMatch(drain, /useEvent\(/)
  assert.match(task, /async run\(\{ context \}\)/)
  assert.match(task, /taskContext: context as Record<string, unknown>/)
  assert.match(drain, /event\?: H3Event/)
  assert.match(drain, /taskContext\?: Record<string, unknown>/)
  assert.match(drain, /options\.event \|\| taskEligibilityEvent\(options\.taskContext\)/)
  assert.ok(drain.indexOf('if (!isAimsDueNotificationDeliveryEnabled())') < drain.lastIndexOf('requireAimsDueNotificationRuntimeBinding()'))
  assert.ok(drain.lastIndexOf('requireAimsDueNotificationRuntimeBinding()') < drain.indexOf('options.event || taskEligibilityEvent'))
  assert.ok(drain.indexOf('if (!isAimsDueNotificationDeliveryEnabled())') < drain.lastIndexOf('await deliverCandidate(eligibilityEvent, candidate)'))
  assert.match(drain, /resolveAimsDueRecipient/)
  assert.doesNotMatch(drain, /findDepartment|managerId/)
  assert.match(drain, /eventVersion: candidate\.eventVersion/)
  assert.match(drain, /actionableKey: candidate\.actionableKey/)
  assert.match(drain, /actionableState: 'pending'/)
  assert.match(drain, /targetAppCode: 'aims'/)
  assert.match(drain, /bizKey: `aims:work_item:/)
  assert.match(drain, /objectVersion: candidate\.eventVersion/)
  assert.match(drain, /aimsDueRecipientTransition\(candidate, recipientUid\)/)
  assert.match(drain, /previousObjectVersion: transition\.previousObjectVersion/)
  assert.match(drain, /advanceNotificationActionableLifecycle/)
  assert.match(drain, /notifications:acknowledge-closure/)
  assert.match(foundationNotifications, /export async function advanceNotificationActionableLifecycle/)
  assert.match(foundationNotifications, /\/api\/v1\/console\/notifications\/actionable-lifecycle/)
  assert.match(foundationNotifications, /audience: 'notifications'/)
  assert.match(foundationNotifications, /scope: 'notifications:publish'/)
  assert.match(foundationNotifications, /responseStatusCode\(error\) !== 401/)
  assert.doesNotMatch(drain, /readBody|getQuery|@all/i)
  assert.doesNotMatch(`${drain}\n${task}\n${render}`.toLowerCase(), /gitlab-runner|\.gitlab-ci/)
})
