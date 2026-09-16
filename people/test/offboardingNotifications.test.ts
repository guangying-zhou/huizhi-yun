import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  peopleOffboardingAuthorizationDescriptor,
  peopleOffboardingEventType,
  peopleOffboardingMessage,
  peopleOffboardingNotificationsEnabled,
  requirePeopleOffboardingRuntimePage,
  resolvePeopleOffboardingRecipient,
  type PeopleOffboardingCandidate
} from '../server/utils/offboardingNotificationPolicy.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidate: PeopleOffboardingCandidate = {
  stream: 'offboarding_handover_due',
  phase: 'D7',
  sourceType: 'offboarding_task',
  sourceId: 42,
  sourceCode: 'OBT-42',
  sourceName: '研发交接',
  caseCode: 'OBC-7',
  taskCode: 'OBT-42',
  taskType: 'handover',
  dueAt: '2026-07-17T12:00:00Z',
  recipientCandidates: ['owner-42'],
  eventVersion: 'people-offboarding:v1',
  idempotencyKey: 'people-offboarding:key',
  actionableKey: 'people:offboarding:task:42'
}

test('People offboarding notifications are closed by default', () => {
  assert.equal(peopleOffboardingNotificationsEnabled(undefined), false)
  assert.equal(peopleOffboardingNotificationsEnabled('false'), false)
  assert.equal(peopleOffboardingNotificationsEnabled('true'), true)
  assert.equal(peopleOffboardingNotificationsEnabled('on'), true)
})

test('People offboarding uses one active direct task owner without fallback', async () => {
  assert.equal(await resolvePeopleOffboardingRecipient(candidate, async uid => ({ uid, status: 'active' })), 'owner-42')
  assert.equal(await resolvePeopleOffboardingRecipient(candidate, async uid => ({ uid, status: 0 })), null)
  assert.equal(await resolvePeopleOffboardingRecipient(candidate, async () => ({ uid: 'manager', status: 1 })), null)
})

test('People offboarding descriptors, event types, and routes use stable task/case codes', () => {
  assert.deepEqual(peopleOffboardingAuthorizationDescriptor(candidate), {
    resource: 'offboarding_task', id: 'OBT-42'
  })
  assert.equal(peopleOffboardingEventType(candidate.stream), 'people.offboarding.handover_due')
  assert.equal(peopleOffboardingMessage(candidate).url, '/people/offboarding-cases/OBC-7?task=OBT-42')
  const asset = {
    ...candidate,
    stream: 'offboarding_asset_recovery_due',
    taskType: 'asset_recovery_coordination'
  } as PeopleOffboardingCandidate
  assert.equal(peopleOffboardingEventType(asset.stream), 'people.offboarding.asset_recovery_due')
})

test('runtime page requires case/task/type identity and exactly one explicit recipient', () => {
  const asOf = '2026-07-10T12:00:00.000Z'
  const page = {
    stream: candidate.stream,
    asOf,
    items: [candidate],
    closures: [{
      checkpointEventVersion: 'people-offboarding:closed',
      expectedVersion: candidate.eventVersion,
      actionableKey: candidate.actionableKey,
      sourceType: 'offboarding_task',
      sourceId: 42,
      caseCode: candidate.caseCode,
      taskCode: candidate.taskCode,
      taskType: candidate.taskType,
      recipientUid: 'owner-42',
      nextVersion: 'resolved:people-offboarding:closed',
      state: 'resolved'
    }],
    nextCursor: null
  }
  assert.deepEqual(requirePeopleOffboardingRuntimePage(page, candidate.stream, asOf), page)
  for (const invalid of [
    { ...candidate, caseCode: undefined },
    { ...candidate, taskCode: 'OBT-41' },
    { ...candidate, taskType: 'asset_recovery_coordination' },
    { ...candidate, recipientCandidates: [] },
    { ...candidate, recipientCandidates: ['owner-42', 'manager'] },
    { ...candidate, recipientCandidates: ['@all'] }
  ]) {
    assert.throws(() => requirePeopleOffboardingRuntimePage({ ...page, items: [invalid] }, candidate.stream, asOf))
  }
  assert.throws(() => requirePeopleOffboardingRuntimePage({
    ...page,
    closures: [{ ...page.closures[0], taskType: 'asset_recovery_coordination' }]
  }, candidate.stream, asOf))
})

test('scheduled delivery is bounded, opt-in, direct-recipient-only, and command deployed', () => {
  const drain = readFileSync(`${root}/server/utils/offboardingNotificationDrain.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/notifications/offboarding-due.ts`, 'utf8')
  const config = readFileSync(`${root}/nuxt.config.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  assert.match(task, /pageSize:\s*100/)
  assert.match(task, /async run\(\{ context \}\)/)
  assert.match(task, /taskContext:\s*context/)
  assert.match(task, /maxPagesPerStream:\s*10/)
  assert.match(task, /maxWallTimeMs:\s*45_000/)
  assert.match(config, /'\*\/15 \* \* \* \*': \['notifications:offboarding-due', 'integrations:assets-offboarding', 'integrations:directory-lifecycle', 'integrations:dead-letter-notifications'\]/)
  assert.match(render, /!enabled\('HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED'\)/)
  assert.match(render, /People scheduled lifecycle delivery requires explicit binding vars/)
  assert.match(drain, /if \(!isPeopleOffboardingNotificationDeliveryEnabled\(\)\)[\s\S]{0,180}requirePeopleDueNotificationRuntimeBinding\(\)/)
  assert.match(drain, /checkEligibility:\s*checkSubjectEligibility/)
  assert.ok(
    drain.indexOf('if (!isPeopleOffboardingNotificationDeliveryEnabled())')
    < drain.indexOf('const event = options.event || scheduledEligibilityEvent(options.taskContext || {})')
  )
  assert.match(drain, /headers:\s*\{ host: 'people-scheduled\.internal' \}/)
  assert.match(drain, /context:\s*\{[\s\S]*\.\.\.context,[\s\S]*nitro:\s*record\(context\.nitro\)/)
  assert.match(drain, /authorizationDescriptor:\s*descriptor/)
  assert.match(drain, /offboarding_handover_due/)
  assert.match(drain, /offboarding_asset_recovery_due/)
  assert.doesNotMatch(`${drain}\n${task}\n${render}`.toLowerCase(), /manager|department|@all|gitlab-runner|\.gitlab-ci/)
})

test('offboarding BFF injects trusted actor and route-specific signed scopes', () => {
  const middleware = readFileSync(`${root}/server/middleware/tenant-runtime.ts`, 'utf8')
  const permissions = readFileSync(`${root}/server/utils/peoplePermissions.ts`, 'utf8')
  assert.match(middleware, /sanitizedQuery\.current_user = currentUser/)
  assert.match(middleware, /`people:offboarding_tasks:\$\{action\}`/)
  assert.match(middleware, /scopes\.push\('people:offboarding_tasks:admin'\)/)
  assert.match(middleware, /action === 'view' \|\| action === 'confirm'/)
  assert.match(middleware, /peopleOffboardingAdminAuthorized = peoplePermissionSnapshotAllows/)
  assert.match(middleware, /resource: 'offboarding_tasks', action: 'confirm'/)
  assert.match(middleware, /resource: 'offboarding_tasks', action: 'cancel'/)
  for (const action of ['view', 'admin', 'confirm', 'cancel']) {
    assert.match(middleware, new RegExp(`return '${action}'`))
  }
  assert.match(permissions, /peoplePermissionSnapshotAllows/)
  assert.doesNotMatch(middleware, /sanitizedQuery\.current_user_scopes/)
})
