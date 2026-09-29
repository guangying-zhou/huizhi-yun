import { createError, defineEventHandler, getRouterParam } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { requireEnterpriseEntitlementStateAccess } from '~~/server/utils/enterpriseEntitlementStateAccess'
import { fulfillConfirmedEnterpriseOrder } from '~~/server/utils/enterpriseOrderFulfillment'

export default defineEventHandler(async (event) => {
  const actorUid = await requireEnterpriseEntitlementStateAccess({ platformAccessScope: event.context.platformAccessScope, platformUid: event.context.platformUid }, buildOpsAuthorizationSnapshot)
  const orderNo = String(getRouterParam(event, 'orderNo') || '').trim()
  const order = await queryRow<RowDataPacket & { id: number, tenant_code: string }>('SELECT id, tenant_code FROM platform_orders WHERE order_no = ? LIMIT 1', [orderNo])
  if (!order) throw createError({ statusCode: 404, message: 'Order not found' })
  try {
    return { success: true, data: await fulfillConfirmedEnterpriseOrder({ tenantCode: order.tenant_code, orderId: Number(order.id), actorUid }) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    if (reason.startsWith('enterprise_order_') || reason.startsWith('invalid_') || reason === 'strict_utc_required') throw createError({ statusCode: 409, message: reason })
    throw createError({ statusCode: 503, message: 'Enterprise order fulfillment unavailable' })
  }
})
