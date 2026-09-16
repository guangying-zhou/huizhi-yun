import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { createIntegration, type UpsertIntegrationInput } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'edit')
  requireIdempotencyKey(event, '创建集成必须提供 Idempotency-Key。')
  const body = await readBody<UpsertIntegrationInput>(event)
  return ok(await createIntegration(event, body))
})
