import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { checkWecomNotificationRuntimeConfig } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  const body: { integrationCode?: unknown } = await readBody(event).catch(() => ({}))
  return ok(await checkWecomNotificationRuntimeConfig({
    event,
    actor,
    integrationCode: body.integrationCode || 'wecom.default'
  }))
})
