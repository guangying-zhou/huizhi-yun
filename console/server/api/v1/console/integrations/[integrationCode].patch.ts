import { getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { updateIntegration, type UpsertIntegrationInput } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'edit')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  const body = await readBody<Partial<UpsertIntegrationInput>>(event)
  return ok(await updateIntegration(integrationCode, body))
})
