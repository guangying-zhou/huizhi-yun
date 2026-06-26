import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { createIntegration, type UpsertIntegrationInput } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  const actor = await requireIntegrationAccess(event, 'edit')
  const body = await readBody<UpsertIntegrationInput>(event)
  return ok(await createIntegration({
    ...body,
    requestedBy: actor.actorId || 'system'
  }))
})
