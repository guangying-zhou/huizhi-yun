import { getQuery } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { listIntegrations } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'view')
  return ok(await listIntegrations(getQuery(event)))
})
