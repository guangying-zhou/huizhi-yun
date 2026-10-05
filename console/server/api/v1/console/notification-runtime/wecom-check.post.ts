import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { checkWecomNotificationRuntimeConfig } from '~~/server/utils/integrations'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  requireIdempotencyKey(event, '检测企业微信配置必须提供 Idempotency-Key。')
  const body: { integrationCode?: unknown } = await readBody(event).catch(() => ({}))
  return ok(await checkWecomNotificationRuntimeConfig({
    event,
    actor,
    integrationCode: body.integrationCode || 'wecom.default'
  }))
})
