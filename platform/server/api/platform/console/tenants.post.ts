import { ok } from '~~/server/utils/api'
import { createOwnedTenant, requireAuthenticatedPlatformAccount } from '~~/server/utils/tenantAccounts'

export default defineEventHandler(async (event) => {
  const { auth } = await requireAuthenticatedPlatformAccount(event, {
    scope: 'tenant_admin'
  })
  const body = await readBody<Record<string, unknown>>(event)
  const tenant = await createOwnedTenant(auth, body || {})

  return ok(tenant)
})
