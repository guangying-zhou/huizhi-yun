import { getQuery } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { listVaultSecrets } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'view')
  return ok(await listVaultSecrets(getQuery(event)))
})
