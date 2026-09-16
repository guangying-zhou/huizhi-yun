import { getHeader, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { setConnectorNotificationActivation } from '~~/server/utils/connectorRuntimeActivation'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  const actor = await requireSystemSettingsAccess(event, 'admin')
  if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
    throw createError({ statusCode: 400, message: '切换通知能力必须提供 Idempotency-Key。' })
  }
  const body = await readBody<{ enabled?: unknown }>(event)
  if (typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'enabled must be a boolean' })
  }
  return ok(await setConnectorNotificationActivation({
    event,
    enabled: body.enabled,
    actorId: actor.actorId || 'system'
  }))
})
