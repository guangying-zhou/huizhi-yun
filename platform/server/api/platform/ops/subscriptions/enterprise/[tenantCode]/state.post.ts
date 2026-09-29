import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { requireEnterpriseEntitlementStateAccess, parseEnterpriseStateRequest } from '~~/server/utils/enterpriseEntitlementStateAccess'
import { changeEnterpriseEntitlementState } from '~~/server/utils/enterpriseEntitlementState'

export default defineEventHandler(async (event) => {
  const actorUid = await requireEnterpriseEntitlementStateAccess({ platformAccessScope: event.context.platformAccessScope, platformUid: event.context.platformUid }, buildOpsAuthorizationSnapshot)
  const tenantCode = String(getRouterParam(event, 'tenantCode') || '').trim()
  const body = await readBody<Record<string, unknown>>(event)
  const command = parseEnterpriseStateRequest(body, tenantCode, actorUid)
  try {
    const result = await changeEnterpriseEntitlementState(command)
    return { success: true, data: result }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'invalid_entitlement_state_command') throw createError({ statusCode: 400, message: code })
    if (['enterprise_tenant_not_found', 'enterprise_entitlement_not_found'].includes(code)) throw createError({ statusCode: 404, message: code })
    if (['entitlement_state_operation_conflict', 'entitlement_state_revision_conflict', 'enterprise_tenant_not_active', 'entitlement_revoked', 'entitlement_not_suspendable', 'entitlement_not_suspended'].includes(code)) throw createError({ statusCode: 409, message: code })
    throw createError({ statusCode: 503, message: 'Enterprise entitlement state operation unavailable' })
  }
})
