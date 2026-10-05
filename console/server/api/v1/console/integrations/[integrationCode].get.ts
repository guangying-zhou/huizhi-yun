import { createError, getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { getIntegration } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'view')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  if (actor.actorType === 'service') {
    throw createError({
      statusCode: 410,
      message: 'Service integration reads moved to the tenant-runtime service integration API.'
    })
  }
  const integration = await getIntegration(event, integrationCode)
  if (!integration) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }
  return ok(integration)
})
