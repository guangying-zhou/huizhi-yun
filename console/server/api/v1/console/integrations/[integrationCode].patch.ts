import { getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { updateIntegration, type UpsertIntegrationInput } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'edit')
  requireIdempotencyKey(event, '更新集成必须提供 Idempotency-Key。')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  const body = await readBody<Partial<UpsertIntegrationInput>>(event)
  return ok(await updateIntegration(event, integrationCode, body))
})
