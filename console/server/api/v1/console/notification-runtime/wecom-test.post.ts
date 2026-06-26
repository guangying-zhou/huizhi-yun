import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { sendWecomIntegrationTestMessage } from '~~/server/utils/integrations'
import { publishPortalNotification, recordPortalNotificationDelivery } from '~~/server/utils/notifications'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || 'unknown error')
}

function deliveryModeLabel(value: unknown) {
  const mode = stringValue(value)
  if (mode === 'notification-runtime') return 'notification-runtime'
  if (mode === 'direct_wecom') return 'Console 直连企业微信'
  return mode || '未知通道'
}

async function tryPublishWecomTestResultNotification(input: {
  actor: Awaited<ReturnType<typeof requireIntegrationAccess>>
  integrationCode: string
  touser: string
  status: 'sent' | 'failed'
  result?: Awaited<ReturnType<typeof sendWecomIntegrationTestMessage>>
  error?: unknown
}) {
  const recipientUid = stringValue(input.actor.actorId)
  if (!recipientUid) return { logged: false, error: 'missing actor uid' }

  try {
    const failed = input.status === 'failed'
    const lastError = failed ? errorMessage(input.error) : null
    const deliveryMode = stringValue(input.result?.deliveryMode)
    const deliveryModeText = deliveryModeLabel(deliveryMode)
    const statusText = failed ? '发送失败' : '发送成功'
    const summary = failed
      ? `向 ${input.touser} 发送企业微信测试消息失败：${lastError}`
      : `已向 ${input.touser} 发送企业微信测试消息，通道：${deliveryModeText}`
    const notification = await publishPortalNotification({
      sourceAppCode: 'console',
      eventType: 'notification_runtime.wecom_test',
      category: 'system',
      severity: failed ? 'error' : 'success',
      title: failed ? '企业微信测试消息发送失败' : '企业微信测试消息发送成功',
      summary,
      body: [
        `目标账号：${input.touser}`,
        `集成：${input.integrationCode}`,
        `通道：${deliveryModeText}`,
        `结果：${statusText}`,
        lastError ? `错误：${lastError}` : null
      ].filter(Boolean).join('\n'),
      actionUrl: '/notification-runtime',
      bizType: 'notification_runtime',
      bizId: input.integrationCode,
      recipients: [recipientUid],
      channels: ['in_app', 'wecom'],
      metadata: {
        integrationCode: input.integrationCode,
        touser: input.touser,
        deliveryMode: deliveryMode || null,
        status: input.status,
        sentAt: input.result?.sentAt || null,
        errorMessage: lastError
      }
    }, {
      actorId: recipientUid,
      appCode: 'console'
    })

    await recordPortalNotificationDelivery({
      notificationId: notification.notificationId,
      uid: recipientUid,
      channel: 'wecom',
      provider: deliveryMode === 'notification-runtime'
        ? 'notification-runtime'
        : deliveryMode === 'direct_wecom'
          ? 'wecom'
          : 'unknown',
      status: failed ? 'failed' : 'success',
      attemptCount: 1,
      lastError,
      sentAt: failed ? null : input.result?.sentAt
    })

    return {
      logged: true,
      notificationId: notification.notificationId
    }
  } catch (notificationError) {
    console.warn('[notification-runtime] failed to publish WeCom test result notification:', notificationError)
    return {
      logged: false,
      error: errorMessage(notificationError)
    }
  }
}

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  const body: { integrationCode?: unknown, touser?: unknown, account?: unknown } = await readBody(event).catch(() => ({}))
  const integrationCode = typeof body.integrationCode === 'string' && body.integrationCode.trim()
    ? body.integrationCode.trim()
    : 'wecom.default'
  const touser = stringValue(body.touser ?? body.account)

  try {
    const result = await sendWecomIntegrationTestMessage({
      event,
      actor,
      integrationCode,
      touser
    })
    return ok({
      ...result,
      messageCenter: await tryPublishWecomTestResultNotification({
        actor,
        integrationCode,
        touser,
        status: 'sent',
        result
      })
    })
  } catch (error) {
    if (touser) {
      await tryPublishWecomTestResultNotification({
        actor,
        integrationCode,
        touser,
        status: 'failed',
        error
      })
    }
    throw error
  }
})
