import { ok } from '~~/server/utils/api'
import { listCurrentTenants, requireAuthenticatedPlatformAccount } from '~~/server/utils/tenantAccounts'

export default defineEventHandler(async (event) => {
  const { auth } = await requireAuthenticatedPlatformAccount(event, {
    scope: 'tenant_admin'
  })
  const items = await listCurrentTenants(auth)

  return ok({
    items,
    total: items.length
  })
})
