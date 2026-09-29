import { createError, type H3Event } from 'h3'
import { requireTenantOwnerForTenantAdmin } from './tenantAdminAccess'

export function requireEnterpriseOrderTenant(event: H3Event, owner = false) {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const actorUid = String(event.context.platformUid || '').trim()
  if (!actorUid) throw createError({ statusCode: 401, message: 'Authenticated enterprise user required' })
  if (event.context.platformAccessScope !== 'tenant-admin' || !tenantCode) throw createError({ statusCode: 403, message: 'Enterprise tenant scope required' })
  if (owner) requireTenantOwnerForTenantAdmin(event, 'Only the enterprise owner may confirm an approved quote')
  return { tenantCode, actorUid }
}
