import { createHash } from 'node:crypto'
import { createError, readBody, type H3Event } from 'h3'
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
  if (mode === 'connector-runtime') return '企业连接运行时'
  return mode || '未知通道'
}

function isConfirmedRuntimeReplay(result: Awaited<ReturnType<typeof sendWecomIntegrationTestMessage>>) {
  const response = result.providerResult
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false
  const data = response.data
  return Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && (data as Record<string, unknown>).replayed === true
  )
}

export function wecomTestResultIdempotencyKey(input: {
  actorId: string
  integrationCode: string
  touser: string
  requestKey: string
  status: 'sent' | 'failed'
}) {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      input.actorId,
      input.integrationCode,
      input.touser,
      input.requestKey,
      input.status
    ]))
    .digest('hex')
  return `console:notification-runtime:wecom-test-result:${digest}`
}

async function tryPublishWecomTestResultNotification(input: {
  event: H3Event
  actor: Awaited<ReturnType<typeof requireIntegrationAccess>>
  integrationCode: string
  touser: string
  requestKey: string
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
      actionUrl: null,
      bizType: 'notification_runtime',
      bizId: input.integrationCode,
      idempotencyKey: wecomTestResultIdempotencyKey({
        actorId: recipientUid,
        integrationCode: input.integrationCode,
        touser: input.touser,
        requestKey: input.requestKey,
        status: input.status
      }),
      recipients: [recipientUid],
      channels: ['in_app', 'wecom'],
      metadata: {
        authorizationDescriptor: {
          resource: 'notification_runtime',
          id: input.integrationCode
        },
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
    }, input.event)

    await recordPortalNotificationDelivery({
      notificationId: notification.notificationId,
      uid: recipientUid,
      channel: 'wecom',
      provider: ['notification-runtime', 'connector-runtime'].includes(deliveryMode)
        ? deliveryMode
        : 'unknown',
      status: failed ? 'failed' : 'success',
      attemptCount: 1,
      lastError,
      sentAt: failed ? null : input.result?.sentAt
    }, input.event)

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
  const body: { integrationCode?: unknown, touser?: unknown, account?: unknown, requestKey?: unknown } = await readBody(event).catch(() => ({}))
  const integrationCode = typeof body.integrationCode === 'string' && body.integrationCode.trim()
    ? body.integrationCode.trim()
    : 'wecom.default'
  const touser = stringValue(body.touser ?? body.account)
  const requestKey = stringValue(body.requestKey)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(requestKey)) {
    throw createError({ statusCode: 400, message: 'requestKey is required for idempotent test delivery' })
  }

  let result: Awaited<ReturnType<typeof sendWecomIntegrationTestMessage>>
  try {
    result = await sendWecomIntegrationTestMessage({
      event,
      integrationCode,
      touser,
      requestKey
    })
  } catch (error) {
    if (touser) {
      await tryPublishWecomTestResultNotification({
        event,
        actor,
        integrationCode,
        touser,
        requestKey,
        status: 'failed',
        error
      })
    }
    throw error
  }

  let replayVerified: boolean | null = null
  try {
    if (result.deliveryMode === 'connector-runtime') {
      const replay = await sendWecomIntegrationTestMessage({
        event,
        integrationCode,
        touser,
        requestKey
      })
      replayVerified = isConfirmedRuntimeReplay(replay)
      if (!replayVerified) {
        throw createError({
          statusCode: 502,
          statusMessage: 'Notification replay verification failed',
          message: '测试消息已发送，但 Enterprise Connector Runtime 未返回已确认的幂等重放证据'
        })
      }
    }
  } catch (error) {
    await tryPublishWecomTestResultNotification({
      event,
      actor,
      integrationCode,
      touser,
      requestKey,
      status: 'sent',
      result
    })
    throw error
  }

  return ok({
    ...result,
    replayVerified,
    messageCenter: await tryPublishWecomTestResultNotification({
      event,
      actor,
      integrationCode,
      touser,
      requestKey,
      status: 'sent',
      result
    })
  })
})
