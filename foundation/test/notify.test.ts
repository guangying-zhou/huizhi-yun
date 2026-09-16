import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  NotificationDeliveryError,
  orchestrateNotificationDelivery,
  resolveExternalRecipients,
  validateNotificationIdempotencyKey,
  type NotificationDeliveryDependencies,
  type NotifyParams
} from '../server/utils/notify.ts'
import type { PublishNotificationInput } from '../server/utils/notifications.ts'

function params(overrides: Partial<NotifyParams> = {}): NotifyParams {
  return {
    touser: ['user-a', 'user-b', 'user-a', ' user-b '],
    title: 'Approval required',
    description: 'Please review the request.',
    url: 'https://tenant.example.test/workflow/tasks/1',
    eventType: 'workflow.notification',
    category: 'approval',
    severity: 'warning',
    bizType: 'workflow_task',
    bizId: 1,
    idempotencyKey: 'workflow:task:1:created',
    metadata: { taskId: 1 },
    ...overrides
  }
}

function dependencies(input: {
  publish?: (notification: PublishNotificationInput) => Promise<unknown>
  external?: (notification: NotifyParams, touser: string) => Promise<unknown>
  sourceAppCode?: string
} = {}): NotificationDeliveryDependencies {
  return {
    resolveSourceAppCode: async () => input.sourceAppCode || 'workflow',
    publishInApp: input.publish || (async () => ({ notificationId: 'notif-1' })),
    sendExternal: input.external || (async () => ({ messageId: 'wecom-1' }))
  }
}

describe('dual-channel notification orchestrator', () => {
  test('applies the test redirect only to WeCom and preserves a frozen DingTalk recipient', () => {
    assert.equal(
      resolveExternalRecipients({ channel: 'wecom', externalRecipients: 'wecom-user' }, 'test-recipient'),
      'test-recipient'
    )
    assert.equal(
      resolveExternalRecipients({ channel: 'dingtalk', externalRecipients: 'dingtalk-subject' }, 'test-recipient'),
      'dingtalk-subject'
    )
  })

  test('publishes in-app and external notifications exactly once with deduplicated UIDs', async () => {
    const published: PublishNotificationInput[] = []
    const external: Array<{ params: NotifyParams, touser: string }> = []
    const order: string[] = []
    const result = await orchestrateNotificationDelivery(params(), dependencies({
      publish: async (input) => {
        order.push('in_app')
        published.push(input)
        return { notificationId: 'notif-1' }
      },
      external: async (notification, touser) => {
        order.push('wecom')
        external.push({ params: notification, touser })
        return { messageId: 'wecom-1' }
      }
    }))

    assert.equal(published.length, 1)
    assert.equal(external.length, 1)
    assert.deepEqual(published[0], {
      event: undefined,
      sourceAppCode: 'workflow',
      eventType: 'workflow.notification',
      category: 'approval',
      severity: 'warning',
      title: 'Approval required',
      summary: 'Please review the request.',
      actionUrl: 'https://tenant.example.test/workflow/tasks/1',
      bizType: 'workflow_task',
      bizId: 1,
      idempotencyKey: 'workflow:task:1:created',
      recipients: ['user-a', 'user-b'],
      channels: ['in_app'],
      metadata: { taskId: 1 }
    })
    assert.equal(external[0]?.touser, 'user-a|user-b')
    assert.equal(external[0]?.params.sourceAppCode, 'workflow')
    assert.equal(external[0]?.params.idempotencyKey, 'workflow:task:1:created')
    assert.deepEqual(order, ['in_app', 'wecom'])
    assert.deepEqual(result.recipients, ['user-a', 'user-b'])
    assert.equal(result.inApp.status, 'fulfilled')
    assert.equal(result.external.status, 'fulfilled')
  })

  test('does not attempt external delivery when the durable in-app publish fails', async () => {
    let externalCalls = 0
    const inAppFailure = new Error('Console unavailable')

    await assert.rejects(
      () => orchestrateNotificationDelivery(params(), dependencies({
        publish: async () => { throw inAppFailure },
        external: async () => {
          externalCalls += 1
          return { messageId: 'wecom-1' }
        }
      })),
      (error) => {
        assert.ok(error instanceof NotificationDeliveryError)
        assert.deepEqual(error.failedChannels, ['in_app'])
        assert.equal(error.result.inApp.reason, inAppFailure)
        assert.equal(error.result.external.status, 'skipped')
        assert.equal(error.result.external.reason, 'in_app_failed')
        return true
      }
    )
    assert.equal(externalCalls, 0)
  })

  test('attempts external delivery once after in-app succeeds and preserves partial success', async () => {
    let publishCalls = 0
    const externalFailure = new Error('Notification runtime unavailable')

    await assert.rejects(
      () => orchestrateNotificationDelivery(params(), dependencies({
        publish: async () => {
          publishCalls += 1
          return { notificationId: 'notif-1' }
        },
        external: async () => { throw externalFailure }
      })),
      (error) => {
        assert.ok(error instanceof NotificationDeliveryError)
        assert.deepEqual(error.failedChannels, ['wecom'])
        assert.equal(error.result.inApp.status, 'fulfilled')
        assert.equal(error.result.external.reason, externalFailure)
        return true
      }
    )
    assert.equal(publishCalls, 1)
  })

  test('reports the configured external channel when DingTalk delivery fails', async () => {
    await assert.rejects(
      () => orchestrateNotificationDelivery(params({ channel: 'dingtalk' }), dependencies({
        publish: async () => ({ notificationId: 'notif-dingtalk' }),
        external: async () => { throw new Error('DingTalk unavailable') }
      })),
      (error) => {
        assert.ok(error instanceof NotificationDeliveryError)
        assert.deepEqual(error.failedChannels, ['dingtalk'])
        return true
      }
    )
  })

  test('rejects empty and @all recipients before either delivery boundary', async () => {
    let deliveryCalls = 0
    const deps = dependencies({
      publish: async () => {
        deliveryCalls += 1
      },
      external: async () => {
        deliveryCalls += 1
      }
    })

    await assert.rejects(
      () => orchestrateNotificationDelivery(params({ touser: [' ', ''] }), deps),
      /requires at least one recipient UID/
    )
    await assert.rejects(
      () => orchestrateNotificationDelivery(params({ touser: ['user-a', '@all'] }), deps),
      /does not accept @all/
    )
    await assert.rejects(
      () => orchestrateNotificationDelivery(params({ touser: ['user-a', '@ALL'] }), deps),
      /does not accept @all/
    )
    assert.equal(deliveryCalls, 0)
  })

  test('uses explicit source app without consulting the runtime resolver', async () => {
    let resolverCalls = 0
    const published: PublishNotificationInput[] = []
    await orchestrateNotificationDelivery(params({ sourceAppCode: 'codocs' }), {
      resolveSourceAppCode: async () => {
        resolverCalls += 1
        return 'wrong-app'
      },
      publishInApp: async (input) => {
        published.push(input)
      },
      sendExternal: async () => undefined
    })

    assert.equal(resolverCalls, 0)
    assert.equal(published[0]?.sourceAppCode, 'codocs')
  })

  test('passes the stable idempotency key to notification-runtime', () => {
    const source = readFileSync(new URL('../server/utils/notify.ts', import.meta.url), 'utf8')
    assert.match(source, /\/v1\/notifications\/send[\s\S]*idempotencyKey:\s*params\.idempotencyKey/)
    assert.match(source, /\/v1\/notifications\/send[\s\S]*sourceAppCode:\s*params\.sourceAppCode/)
  })

  test('external delivery fails closed when notification-runtime is unavailable', () => {
    const source = readFileSync(new URL('../server/utils/notify.ts', import.meta.url), 'utf8')
    assert.match(source, /if \(!runtimeUrl\)[\s\S]*notification-runtime is not configured/)
    assert.doesNotMatch(source, /message\/send|allowLegacyFallback|Falling back to legacy WeCom/)
  })

  test('all environments reject a missing or oversized idempotency key before delivery', () => {
    assert.throws(
      () => validateNotificationIdempotencyKey(undefined),
      /Notifications require an idempotencyKey/
    )
    assert.throws(
      () => validateNotificationIdempotencyKey('x'.repeat(192)),
      /Notifications require an idempotencyKey/
    )
    assert.equal(validateNotificationIdempotencyKey(' stable-key '), 'stable-key')
  })

  test('shared WebDev feedback notifications use the created issue as a stable event identity', () => {
    const source = readFileSync(new URL('../server/utils/feedbackNotify.ts', import.meta.url), 'utf8')
    assert.match(source, /const issueId = stringValue\([\s\S]*?\.id\)/)
    assert.match(source, /if \(!issueId\) return false/)
    assert.match(source, /eventType:\s*'webdev\.feedback\.created'/)
    assert.match(source, /bizType:\s*'webdev_issue'/)
    assert.match(source, /bizId:\s*issueId/)
    assert.match(source, /idempotencyKey:\s*`webdev-feedback:\$\{issueId\}:created`/)
    assert.doesNotMatch(source, /idempotencyKey:[^\n]*(Date\.now|Math\.random)/)
  })
})
