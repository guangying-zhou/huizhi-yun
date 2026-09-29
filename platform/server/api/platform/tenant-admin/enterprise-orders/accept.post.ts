import { createError, defineEventHandler, readBody } from 'h3'
import { requireEnterpriseOrderTenant } from '~~/server/utils/enterpriseOrderTenantAccess'
import { acceptApprovedEnterpriseOrder } from '~~/server/utils/enterpriseOrderApproval'

export default defineEventHandler(async (event) => {
  const context = requireEnterpriseOrderTenant(event, true)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Object.keys(body).some(key => key !== 'orderNo') || typeof body.orderNo !== 'string') throw createError({ statusCode: 400, message: 'Only approved orderNo can be confirmed' })
  try {
    return { success: true, data: await acceptApprovedEnterpriseOrder({ ...context, orderNo: body.orderNo }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('enterprise_order_')) throw createError({ statusCode: 409, message })
    throw createError({ statusCode: 503, message: 'Order acceptance unavailable' })
  }
})
