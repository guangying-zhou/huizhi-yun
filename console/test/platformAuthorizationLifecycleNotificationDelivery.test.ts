import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  deliverLifecycleFailureNotification,
  parseLifecycleNotificationRecipients
} from '../server/utils/platformAuthorizationLifecycleNotificationDelivery.ts'

describe('Platform authorization lifecycle notification delivery', () => {
  test('parses JSON or CSV recipient settings and removes duplicates', () => {
    assert.deepEqual(parseLifecycleNotificationRecipients('["admin-1", "admin-1", "admin-2"]'), ['admin-1', 'admin-2'])
    assert.deepEqual(parseLifecycleNotificationRecipients('admin-1, admin-2, admin-1'), ['admin-1', 'admin-2'])
    assert.deepEqual(parseLifecycleNotificationRecipients(null), [])
  })

  test('delivers only to the active operator without loading fallback recipients', async () => {
    let fallbackLoaded = false
    const published: string[][] = []
    const result = await deliverLifecycleFailureNotification({
      operatorUid: 'hr-operator',
      targetUid: 'employee-1'
    }, {
      loadConfiguredRecipients: async () => {
        fallbackLoaded = true
        return ['security-admin']
      },
      filterActiveRecipients: async uids => uids,
      publish: async (recipients) => {
        published.push(recipients)
        return { notificationId: 'n-1' }
      }
    })

    assert.equal(fallbackLoaded, false)
    assert.deepEqual(published, [['hr-operator']])
    assert.deepEqual(result, {
      ok: true,
      delivery: 'portal',
      recipientSource: 'operator',
      recipients: ['hr-operator'],
      published: { notificationId: 'n-1' }
    })
  })

  test('uses unique active fallback admins and excludes the lifecycle target', async () => {
    const published: string[][] = []
    const result = await deliverLifecycleFailureNotification({
      operatorUid: '',
      targetUid: 'employee-1'
    }, {
      loadConfiguredRecipients: async () => ['security-admin', 'inactive-admin', 'security-admin', 'employee-1'],
      filterActiveRecipients: async uids => uids.filter(uid => uid !== 'inactive-admin'),
      publish: async (recipients) => {
        published.push(recipients)
        return { notificationId: 'n-2' }
      }
    })

    assert.deepEqual(published, [['security-admin']])
    assert.deepEqual(result, {
      ok: true,
      delivery: 'portal',
      recipientSource: 'configured_fallback',
      recipients: ['security-admin'],
      published: { notificationId: 'n-2' }
    })
  })

  test('keeps the failure in the operation-log queue when no active recipient exists', async () => {
    let publishCalled = false
    const warnings: Array<Record<string, unknown>> = []
    const result = await deliverLifecycleFailureNotification({
      targetUid: 'employee-1'
    }, {
      loadConfiguredRecipients: async () => ['inactive-admin', 'employee-1'],
      filterActiveRecipients: async () => [],
      publish: async () => {
        publishCalled = true
        return { notificationId: 'unexpected' }
      },
      warn: (_message, context) => warnings.push(context)
    })

    assert.equal(publishCalled, false)
    assert.equal(warnings.length, 1)
    assert.deepEqual(result, {
      ok: false,
      delivery: 'operation_log_only',
      reason: 'missing_operator_and_fallback_recipients'
    })
  })

  test('reports portal delivery failure without throwing into lifecycle orchestration', async () => {
    const result = await deliverLifecycleFailureNotification({
      operatorUid: 'hr-operator',
      targetUid: 'employee-1'
    }, {
      loadConfiguredRecipients: async () => [],
      filterActiveRecipients: async uids => uids,
      publish: async () => {
        throw new Error('notification database unavailable')
      },
      warn: () => {}
    })

    assert.deepEqual(result, {
      ok: false,
      delivery: 'failed',
      error: 'notification database unavailable'
    })
  })

  test('reports recipient resolution failure without throwing into lifecycle orchestration', async () => {
    const result = await deliverLifecycleFailureNotification({
      targetUid: 'employee-1'
    }, {
      loadConfiguredRecipients: async () => {
        throw new Error('settings database unavailable')
      },
      filterActiveRecipients: async uids => uids,
      publish: async () => ({ notificationId: 'unexpected' }),
      warn: () => {}
    })

    assert.deepEqual(result, {
      ok: false,
      delivery: 'failed',
      error: 'settings database unavailable'
    })
  })
})
