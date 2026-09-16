import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNotificationDetailAuthorizationRequest,
  requireNotificationDetailAuthorizationCaller
} from '../server/utils/notificationDetailAuthorization.ts'

function event(auth: Record<string, unknown>) {
  return { context: { consoleAuth: auth } } as never
}

const request = parseNotificationDetailAuthorizationRequest({
  notificationId: 'notification-1',
  descriptor: { resource: 'work_item', id: '42' },
  subject: { uid: 'u-1' },
  tenantId: 'tenant-a',
  deploymentId: 'deployment-a'
})

describe('notification detail authorization service boundary', () => {
  test('accepts only the Console service identity with exact scope and deployment context', async () => {
    const result = await requireNotificationDetailAuthorizationCaller(event({
      authenticated: true,
      tokenUse: 'service',
      subjectType: 'service',
      appCode: 'console',
      scopes: ['aims:notification-details:authorize'],
      tenant: 'tenant-a',
      deployment: 'deployment-a'
    }), request, { scope: 'aims:notification-details:authorize' })

    assert.deepEqual(result, {
      sourceApp: 'console',
      tenantId: 'tenant-a',
      deploymentId: 'deployment-a',
      subjectUid: 'u-1'
    })
  })

  test('rejects browser auth, wrong caller, scope and tenant/deployment mismatches', async () => {
    const base = {
      authenticated: true,
      tokenUse: 'service',
      subjectType: 'service',
      appCode: 'console',
      scopes: ['workflow:notification-details:authorize'],
      tenant: 'tenant-a',
      deployment: 'deployment-a'
    }
    const cases = [
      { ...base, tokenUse: 'access', subjectType: 'user' },
      { ...base, appCode: 'assets' },
      { ...base, scopes: [] },
      { ...base, tenant: 'tenant-b' },
      { ...base, deployment: 'deployment-b' }
    ]
    const expected = [401, 403, 403, 403, 403]

    for (const [index, auth] of cases.entries()) {
      await assert.rejects(
        requireNotificationDetailAuthorizationCaller(
          event(auth),
          request,
          { scope: 'workflow:notification-details:authorize' }
        ),
        error => Number((error as { statusCode?: number }).statusCode) === expected[index]
      )
    }
  })

  test('requires a server authorization descriptor and trusted context fields', () => {
    assert.throws(
      () => parseNotificationDetailAuthorizationRequest({ subject: { uid: 'u-1' } }),
      error => Number((error as { statusCode?: number }).statusCode) === 400
    )
    assert.throws(
      () => parseNotificationDetailAuthorizationRequest({
        notificationId: 'notification-1',
        descriptor: {},
        subject: { uid: 'bad\nuid' },
        tenantId: 'tenant-a',
        deploymentId: 'deployment-a'
      }),
      error => Number((error as { statusCode?: number }).statusCode) === 400
    )
    assert.throws(
      () => parseNotificationDetailAuthorizationRequest({
        notificationId: 'bad\nnotification',
        descriptor: {},
        subject: { uid: 'u-1' },
        tenantId: 'tenant-a',
        deploymentId: 'deployment-a'
      }),
      error => Number((error as { statusCode?: number }).statusCode) === 400
    )
  })
})
