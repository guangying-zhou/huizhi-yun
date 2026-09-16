import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import {
  activateTenantPlanSubscription,
  buildTenantPlanPaymentNo,
  TENANT_PLAN_TRIAL_DAYS
} from '~~/server/utils/tenantPlanSubscriptions'

interface OrderRow extends RowDataPacket {
  id: number
  order_no: string
  tenant_code: string
  plan_code: string
  payment_method: string | null
  status: string
  total_amount: string | null
  currency: string | null
}

function normalizeMysqlDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'paidAt must be a valid date time'
    })
  }

  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}

export default defineEventHandler(async (event) => {
  const orderNo = String(getRouterParam(event, 'orderNo') || '').trim()
  const accountId = Number(event.context.platformAccountId || 0) || null
  const body: Record<string, unknown> = await readBody<Record<string, unknown>>(event).catch(
    () => ({} as Record<string, unknown>)
  )

  if (!orderNo) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'orderNo is required'
    })
  }

  const result = await withTransaction(async (tx) => {
    const order = await tx.queryRow<OrderRow>(
      `SELECT id, order_no, tenant_code, plan_code, payment_method, status, total_amount, currency
       FROM platform_orders
       WHERE order_no = ?
       LIMIT 1
       FOR UPDATE`,
      [orderNo]
    )

    if (!order) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `order not found: ${orderNo}`
      })
    }

    if (order.status === 'paid') {
      return {
        orderNo: order.order_no,
        status: order.status,
        alreadyConfirmed: true
      }
    }

    if (order.status !== 'pending' || order.payment_method !== 'bank_transfer') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `order cannot be confirmed: status=${order.status}, paymentMethod=${order.payment_method || ''}`
      })
    }

    const paidAt = normalizeMysqlDateTime(normalizeNullableString(body.paidAt) || new Date().toISOString())
    const bankTransactionNo = requireString(body.bankTransactionNo, 'bankTransactionNo')
    const paymentNo = buildTenantPlanPaymentNo(order.tenant_code)
    const amount = order.total_amount !== null ? Number(order.total_amount) : 0
    const currency = order.currency || 'CNY'

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_orders
       SET status = 'paid',
           paid_at = ?,
           effective_from = ?,
           effective_until = DATE_ADD(?, INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [paidAt, paidAt, paidAt, order.id]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_payments
        (payment_no, order_id, invoice_id, tenant_code, amount, currency, method, status,
         transaction_ref, paid_at, confirmed_by_account_id, confirmed_at, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'bank_transfer', 'succeeded',
         ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [paymentNo, order.id, order.tenant_code, amount, currency, bankTransactionNo, paidAt, accountId]
    )

    // 新流程下单即激活：若该订单对应的订阅已 active，仅记录到账、不再重算到期日；
    // 仅当历史「待确认」订阅尚未激活时才在此激活（兼容旧数据）。
    const activatedSubscription = await tx.queryRow<RowDataPacket & { id: number }>(
      `SELECT id
       FROM tenant_subscriptions
       WHERE tenant_code = ?
         AND current_order_id = ?
         AND status = 'active'
       LIMIT 1`,
      [order.tenant_code, order.id]
    )

    const subscriptionId = activatedSubscription
      ? activatedSubscription.id
      : await activateTenantPlanSubscription(tx, {
          tenantCode: order.tenant_code,
          planCode: order.plan_code,
          orderId: order.id,
          accountId,
          source: 'self_service',
          activatedAt: paidAt
        })

    return {
      orderNo: order.order_no,
      status: 'paid',
      paymentNo,
      paidAt,
      bankTransactionNo,
      confirmedByAccountId: accountId,
      subscriptionId,
      trialDays: TENANT_PLAN_TRIAL_DAYS
    }
  })

  return ok(result)
})
