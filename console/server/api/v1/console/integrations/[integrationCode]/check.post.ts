import { getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { checkIntegration } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  return ok(await checkIntegration({
    event,
    integrationCode,
    actor
  }))
})
