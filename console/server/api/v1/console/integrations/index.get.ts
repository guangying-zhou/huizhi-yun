import { createError, getQuery } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { listIntegrations } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'view')
  if (actor.actorType === 'service') {
    throw createError({
      statusCode: 410,
      message: 'Service integration reads moved to the tenant-runtime service integration API.'
    })
  }
  return ok(await listIntegrations(event, getQuery(event)))
})
