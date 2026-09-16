import { getRouterParam, readBody } from 'h3'
import { addConsoleVaultSecretVersion } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'edit')
  requireIdempotencyKey(event)
  const secretCode = getRouterParam(event, 'secretCode') || ''
  const body = await readBody<{
    storageBackend?: unknown
    material?: { plaintext?: unknown, backendSecretRef?: unknown } | null
  }>(event)
  return await addConsoleVaultSecretVersion(event, secretCode, body, 'versions')
})
