import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  requireAltocNotificationAuthorizationResult,
  requireAltocNotificationDescriptor
} from '../server/utils/receivableNotificationDetailResult.ts'

const operationId = '90b90bf3-5899-4aed-98c8-23dd1897f463'
const descriptor = { resource: 'integration_operation', id: operationId } as const

test('Altoc accepts only the exact integration operation descriptor and minimal decision', () => {
  assert.deepEqual(requireAltocNotificationDescriptor(descriptor), descriptor)
  assert.deepEqual(requireAltocNotificationAuthorizationResult({
    authorized: true,
    reasonCode: 'allowed',
    ...descriptor
  }, descriptor), {
    authorized: true,
    reasonCode: 'allowed',
    ...descriptor
  })
  for (const reasonCode of ['not_found', 'not_recipient', 'stale_notification']) {
    assert.deepEqual(requireAltocNotificationAuthorizationResult({
      authorized: false,
      reasonCode,
      ...descriptor
    }, descriptor), {
      authorized: false,
      reasonCode,
      ...descriptor
    })
  }
})

test('Altoc fails closed on operation binding drift and sensitive runtime evidence', () => {
  for (const invalidDescriptor of [
    { ...descriptor, id: 'not-a-uuid' },
    { ...descriptor, id: '90b90bf3-5899-1aed-98c8-23dd1897f463' },
    { ...descriptor, sourceApp: 'altoc' }
  ]) assert.throws(() => requireAltocNotificationDescriptor(invalidDescriptor))

  for (const invalidResult of [
    { authorized: true, reasonCode: 'allowed', ...descriptor, recipientUids: ['u1'] },
    { authorized: true, reasonCode: 'allowed', ...descriptor, operationVersion: 7 },
    { authorized: true, reasonCode: 'allowed', ...descriptor, deploymentCode: 'd1' },
    { authorized: false, reasonCode: 'allowed', ...descriptor },
    { authorized: false, reasonCode: 'stale_notification', ...descriptor, notificationId: 'n1' },
    { authorized: true, reasonCode: 'allowed', resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f464' }
  ]) assert.throws(() => requireAltocNotificationAuthorizationResult(invalidResult, descriptor))
})

test('Altoc Console-only endpoint authenticates before body and delegates only bound detail facts', () => {
  const route = readFileSync(new URL('../server/api/v1/service/notification-details/authorize.post.ts', import.meta.url), 'utf8')
  const authorization = readFileSync(new URL('../server/utils/receivableNotificationDetailAuthorization.ts', import.meta.url), 'utf8')
  assert.ok(route.indexOf('requireAltocServiceAuth') < route.indexOf('readBody(event)'))
  assert.match(route, /altoc:notification-details:authorize/)
  assert.match(authorization, /notificationDetailActor/)
  assert.match(authorization, /body: \{ notificationId, descriptor \}/)
  assert.doesNotMatch(authorization, /recipientUids|generation|operationVersion|actionableKey|objectVersion/)
})

test('existing manifest permission and Console grant cover fresh view plus source verification', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
    resources: Array<{ code: string, actions: string[] }>
  }
  const operations = manifest.resources.find(resource => resource.code === 'integration_operations')
  assert.ok(operations?.actions.includes('view'))
  const seed = readFileSync(new URL('../../console/docs/sql/Console-SQL-Seed-v1.40-console-runtime-altoc-notification-details.sql', import.meta.url), 'utf8')
  assert.match(seed, /altoc:notification-details['`]?\s*,\s*['`]?authorize/)
  assert.doesNotMatch(seed, /recipient|generation|operation[_-]?id/i)
})
