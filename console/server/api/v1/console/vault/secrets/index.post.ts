import { readBody } from 'h3'
import { createConsoleVaultSecret } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'edit')
  requireIdempotencyKey(event)
  const body = await readBody<Record<string, unknown>>(event)
  return await createConsoleVaultSecret(event, body)
})
