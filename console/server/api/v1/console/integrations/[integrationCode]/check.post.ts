import { getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { checkIntegration } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  requireIdempotencyKey(event, '检测集成配置必须提供 Idempotency-Key。')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  return ok(await checkIntegration({
    event,
    integrationCode,
    actor
  }))
})
