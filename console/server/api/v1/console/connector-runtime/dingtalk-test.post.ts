import { createError, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { sendDingTalkIntegrationTestMessage } from '~~/server/utils/integrations'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function isConfirmedRuntimeReplay(result: Awaited<ReturnType<typeof sendDingTalkIntegrationTestMessage>>) {
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

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'edit')
  const body: {
    integrationCode?: unknown
    touser?: unknown
    account?: unknown
    requestKey?: unknown
  } = await readBody(event).catch(() => ({}))
  const integrationCode = stringValue(body.integrationCode) || 'dingtalk.default'
  const touser = stringValue(body.touser ?? body.account)
  const requestKey = stringValue(body.requestKey)

  const result = await sendDingTalkIntegrationTestMessage({
    event,
    integrationCode,
    touser,
    requestKey
  })
  if (result.deliveryMode !== 'connector-runtime') {
    throw createError({
      statusCode: 409,
      message: '钉钉通知测试只允许通过 Enterprise Connector Runtime 执行'
    })
  }

  const replay = await sendDingTalkIntegrationTestMessage({
    event,
    integrationCode,
    touser,
    requestKey
  })
  if (!isConfirmedRuntimeReplay(replay)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'DingTalk notification replay verification failed',
      message: '测试消息已发送，但 Enterprise Connector Runtime 未返回已确认的幂等重放证据'
    })
  }

  return ok({
    ...result,
    replayVerified: true
  })
})
