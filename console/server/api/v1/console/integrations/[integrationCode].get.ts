import { createError, getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { getIntegration } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'view')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  const integration = await getIntegration(integrationCode)
  if (!integration) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }
  return ok(integration)
})
