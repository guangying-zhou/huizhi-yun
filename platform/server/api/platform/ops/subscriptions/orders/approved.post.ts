import { createError, defineEventHandler, readBody } from 'h3'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { requireEnterpriseEntitlementStateAccess } from '~~/server/utils/enterpriseEntitlementStateAccess'
import { createApprovedEnterpriseOrder, type EnterpriseApprovedOrderInput } from '~~/server/utils/enterpriseOrderApproval'

export default defineEventHandler(async (event) => {
  const actorUid = await requireEnterpriseEntitlementStateAccess({ platformAccessScope: event.context.platformAccessScope, platformUid: event.context.platformUid }, buildOpsAuthorizationSnapshot)
  const body = await readBody<Record<string, unknown>>(event)
  const allowed = ['tenantCode', 'requestId', 'approvalReference', 'effectiveFrom', 'effectiveUntil', 'amount', 'currency']
  if (!body || Object.keys(body).some(key => !allowed.includes(key))) throw createError({ statusCode: 400, message: 'Invalid approved order fields' })
  try {
    return { success: true, data: await createApprovedEnterpriseOrder({ ...body, actorUid } as EnterpriseApprovedOrderInput) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('enterprise_order_') || message.startsWith('invalid_') || message === 'strict_utc_required') throw createError({ statusCode: 409, message })
    throw createError({ statusCode: 503, message: 'Approved order creation unavailable' })
  }
})
