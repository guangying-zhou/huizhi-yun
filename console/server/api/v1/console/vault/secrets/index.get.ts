import { getQuery } from 'h3'
import { getConsoleVaultSecrets } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'credential_vault', 'view')
  return await getConsoleVaultSecrets(event, getQuery(event))
})
