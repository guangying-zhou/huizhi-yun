import { getHeader, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { setConnectorIdentityActivation } from '~~/server/utils/connectorRuntimeActivation'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  const actor = await requireSystemSettingsAccess(event, 'admin')
  if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
    throw createError({ statusCode: 400, message: '切换身份能力必须提供 Idempotency-Key。' })
  }
  const body = await readBody<{ enabled?: unknown, provider?: unknown }>(event)
  if (typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'enabled must be a boolean' })
  }
  const provider = body.provider === undefined ? 'wecom' : String(body.provider || '').trim()
  if (provider !== 'wecom' && provider !== 'dingtalk') {
    throw createError({ statusCode: 400, message: 'provider must be wecom or dingtalk' })
  }
  return ok(await setConnectorIdentityActivation({
    event,
    enabled: body.enabled,
    actorId: actor.actorId || 'system',
    provider
  }))
})
