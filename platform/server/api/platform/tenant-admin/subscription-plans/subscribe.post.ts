import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import {
  activateTenantPlanSubscription,
  buildTenantPlanOrderNo,
  buildTenantPlanPaymentNo,
  isPlanPaymentMethod,
  TENANT_PLAN_TRIAL_DAYS
} from '~~/server/utils/tenantPlanSubscriptions'

interface PlanRow extends RowDataPacket {
  id: number
  plan_code: string
  plan_name: string
  plan_tier: string
  base_price: string | null
  currency: string | null
}

interface ActiveSubscriptionRow extends RowDataPacket {
  id: number
  plan_code: string
  ended_at: string | null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const accountId = Number(event.context.platformAccountId || 0) || null
  const planCode = requireString(body.planCode, 'planCode')
  const paymentMethod = normalizeNullableString(body.paymentMethod) || ''

  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  if (!isPlanPaymentMethod(paymentMethod)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'paymentMethod must be bank_transfer, wechat_pay, or alipay'
    })
  }

  const result = await withTransaction(async (tx) => {
    const plan = await tx.queryRow<PlanRow>(
      `SELECT id, plan_code, plan_name, plan_tier, base_price, currency
       FROM platform_plans
       WHERE plan_code = ?
         AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [planCode]
    )

    if (!plan) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `active plan not found: ${planCode}`
      })
    }

    const active = await tx.queryRow<ActiveSubscriptionRow>(
      `SELECT id, plan_code, ended_at
       FROM tenant_subscriptions
       WHERE tenant_code = ?
         AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [tenantCode]
    )

    const amount = plan.base_price !== null ? Number(plan.base_price) : 0
    const currency = plan.currency || 'CNY'
    const orderNo = buildTenantPlanOrderNo(tenantCode)
    const isBankTransfer = paymentMethod === 'bank_transfer'
    const orderStatus = isBankTransfer ? 'pending' : 'paid'
    const orderNotes = isBankTransfer
      ? `payment_method=bank_transfer;trial_days=${TENANT_PLAN_TRIAL_DAYS};activation=ops_confirm_required`
      : `payment_method=${paymentMethod};trial_days=${TENANT_PLAN_TRIAL_DAYS};activation=auto`

    if (isBankTransfer) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_orders
         SET status = 'cancelled',
             notes = CONCAT(COALESCE(notes, ''), ';cancelled_by_new_bank_transfer_order'),
             updated_at = UTC_TIMESTAMP()
         WHERE tenant_code = ?
           AND status = 'pending'
           AND payment_method = 'bank_transfer'`,
        [tenantCode]
      )

      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_subscriptions
         SET status = 'ended',
             ended_at = COALESCE(ended_at, UTC_TIMESTAMP()),
             updated_at = UTC_TIMESTAMP()
         WHERE tenant_code = ?
           AND status = 'pending'
           AND source = 'self_service'`,
        [tenantCode]
      )
    }

    const orderResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_orders
        (order_no, tenant_code, plan_code, quantity, unit_price, total_amount,
         currency, payment_method, status, placed_at, paid_at, effective_from,
         effective_until, created_by_account_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, UTC_TIMESTAMP(),
         ${isBankTransfer ? 'NULL, NULL, NULL' : `UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY)`},
         ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        orderNo,
        tenantCode,
        plan.plan_code,
        amount,
        amount,
        currency,
        paymentMethod,
        orderStatus,
        accountId,
        orderNotes
      ]
    )

    let subscriptionId: number | null = null
    let paymentNo: string | null = null

    // 直付即时入账；对公转账先挂 pending 订单。两种方式都「下单即开通」——
    // 立即激活订阅，30 天内付款由前端提示，逾期未付款由运营手动停服。
    if (!isBankTransfer) {
      paymentNo = buildTenantPlanPaymentNo(tenantCode)
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_payments
          (payment_no, order_id, invoice_id, tenant_code, amount, currency, method, status, paid_at, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'succeeded', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [paymentNo, orderResult.insertId, tenantCode, amount, currency, paymentMethod]
      )
    }

    subscriptionId = await activateTenantPlanSubscription(tx, {
      tenantCode,
      planCode: plan.plan_code,
      orderId: orderResult.insertId,
      accountId,
      source: active ? 'self_service' : 'trial'
    })

    return {
      order: {
        orderNo,
        status: orderStatus,
        paymentMethod,
        totalAmount: amount,
        currency,
        paymentNo,
        trialDays: TENANT_PLAN_TRIAL_DAYS,
        activationRequired: isBankTransfer
      },
      subscription: {
        id: subscriptionId,
        status: 'active',
        planCode: plan.plan_code,
        planName: plan.plan_name,
        previousPlanCode: active?.plan_code || null,
        endedAtPreserved: Boolean(active?.ended_at)
      }
    }
  })

  return ok(result)
})
