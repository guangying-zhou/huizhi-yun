import { getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireIntegrationAccess } from '~~/server/utils/integrationAccess'
import { rotateIntegrationCredential, type IntegrationCredentialInput } from '~~/server/utils/integrations'

export default defineEventHandler(async (event) => {
  await requireIntegrationAccess(event, 'edit')
  requireIdempotencyKey(event, '轮换集成凭证必须提供 Idempotency-Key。')
  const integrationCode = getRouterParam(event, 'integrationCode') || ''
  const body = await readBody<IntegrationCredentialInput>(event)
  return ok(await rotateIntegrationCredential(event, integrationCode, body))
})
