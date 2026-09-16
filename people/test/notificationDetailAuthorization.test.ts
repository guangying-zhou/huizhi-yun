import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  requirePeopleNotificationAuthorizationDescriptor,
  requirePeopleNotificationDetailAuthorizationResult
} from '../server/utils/notificationDetailAuthorizationResult.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

test('People notification descriptors accept only exact supported tuples', () => {
  const descriptor = { resource: 'offboarding_task', id: 'OBT-42' } as const
  assert.deepEqual(requirePeopleNotificationAuthorizationDescriptor(descriptor), descriptor)
  const operationDescriptor = { resource: 'integration_operation', id: '550e8400-e29b-41d4-a716-446655440080' } as const
  assert.deepEqual(requirePeopleNotificationAuthorizationDescriptor(operationDescriptor), operationDescriptor)
  for (const invalid of [
    { resource: 'employee', id: 'OBT-42' },
    { resource: 'offboarding_task', id: 'OBT-42', caseCode: 'OBC-7' },
    { resource: 'offboarding_task', id: '' },
    { resource: 'offboarding_task', id: 'OBT\n42' },
    { resource: 'integration_operation', id: '550E8400-E29B-41D4-A716-446655440080' },
    { resource: 'integration_operation', id: operationDescriptor.id, extra: true }
  ]) {
    assert.throws(() => requirePeopleNotificationAuthorizationDescriptor(invalid))
  }
})

test('People integration operation authorization only accepts source-verifier rejections', () => {
  const descriptor = { resource: 'integration_operation', id: '550e8400-e29b-41d4-a716-446655440080' } as const
  for (const reasonCode of ['not_found', 'not_recipient', 'stale_notification']) {
    assert.deepEqual(requirePeopleNotificationDetailAuthorizationResult({
      authorized: false,
      reasonCode,
      resource: descriptor.resource,
      id: descriptor.id
    }, descriptor), { authorized: false, reasonCode, ...descriptor })
  }
  assert.throws(() => requirePeopleNotificationDetailAuthorizationResult({
    authorized: false,
    reasonCode: 'not_authorized',
    resource: descriptor.resource,
    id: descriptor.id
  }, descriptor))
})

test('People notification authorization result is exact and descriptor-bound', () => {
  const descriptor = { resource: 'offboarding_task', id: 'OBT-42' } as const
  assert.deepEqual(requirePeopleNotificationDetailAuthorizationResult({
    authorized: true,
    reasonCode: 'allowed',
    resource: 'offboarding_task',
    id: 'OBT-42'
  }, descriptor), {
    authorized: true,
    reasonCode: 'allowed',
    resource: 'offboarding_task',
    id: 'OBT-42'
  })
  for (const invalid of [
    { authorized: true, reasonCode: 'not_authorized', resource: 'offboarding_task', id: 'OBT-42' },
    { authorized: true, reasonCode: 'allowed', resource: 'offboarding_task', id: 'OBT-41' },
    { authorized: false, reasonCode: 'direct_relation_required', resource: 'offboarding_task', id: 'OBT-42' },
    { authorized: true, reasonCode: 'allowed', resource: 'offboarding_task', id: 'OBT-42', owner: 'forged' }
  ]) {
    assert.throws(() => requirePeopleNotificationDetailAuthorizationResult(invalid, descriptor))
  }
})

test('People BFF authenticates capability before body and uses purpose-bound runtime delegation', () => {
  const route = readFileSync(`${root}/server/api/v1/service/notification-details/authorize.post.ts`, 'utf8')
  const authorization = readFileSync(`${root}/server/utils/notificationDetailAuthorization.ts`, 'utf8')
  assert.ok(route.indexOf('await requireServiceScope') < route.indexOf('await readBody'))
  assert.match(route, /scope: 'people:notification-details:authorize'/)
  assert.match(route, /allowedApps: \['console'\]/)
  assert.match(route, /requireNotificationDetailAuthorizationCaller/)
  assert.match(authorization, /\/v1\/people\/notification-details\/authorize/)
  assert.match(authorization, /scope: 'people\.read'/)
  assert.match(authorization, /notificationDetailActor:/)
  assert.doesNotMatch(route, /query|x-hzy-actor-uid/)
})
