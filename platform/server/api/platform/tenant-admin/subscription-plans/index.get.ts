import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import { TENANT_PLAN_TRIAL_DAYS } from '~~/server/utils/tenantPlanSubscriptions'

interface PlanRow extends RowDataPacket {
  id: number
  plan_code: string
  plan_name: string
  plan_tier: string
  price_model: string
  base_price: string | null
  currency: string | null
  billing_cycle: string | null
  description: string | null
  app_count: number
  app_names: string | null
  capability_count: number
  capability_names: string | null
}

interface TenantSubscriptionRow extends RowDataPacket {
  id: number
  subscription_no: string
  plan_code: string
  plan_name: string | null
  plan_tier: string | null
  status: string
  source: string
  started_at: string | null
  ended_at: string | null
  current_order_id: number | null
}

interface OrderRow extends RowDataPacket {
  order_no: string
  plan_code: string
  plan_name: string | null
  status: string
  payment_method: string | null
  total_amount: string | null
  currency: string | null
  placed_at: string
  paid_at: string | null
  effective_from: string | null
  effective_until: string | null
}

function splitList(value: string | null) {
  return value ? value.split('||').map(item => item.trim()).filter(Boolean) : []
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  const plans = await queryRows<PlanRow[]>(
    `SELECT p.id,
            p.plan_code,
            p.plan_name,
            p.plan_tier,
            p.price_model,
            p.base_price,
            p.currency,
            p.billing_cycle,
            p.description,
            (SELECT COUNT(*)
               FROM platform_plan_apps ppa
              WHERE ppa.plan_id = p.id) AS app_count,
            (SELECT GROUP_CONCAT(pa.app_name ORDER BY ppa.role_in_plan, ppa.sort_order, pa.app_code SEPARATOR '||')
               FROM platform_plan_apps ppa
               JOIN platform_applications pa ON pa.app_code = ppa.app_code
              WHERE ppa.plan_id = p.id) AS app_names,
            (SELECT COUNT(*)
               FROM platform_plan_capabilities ppc
              WHERE ppc.plan_id = p.id) AS capability_count,
            (SELECT GROUP_CONCAT(
                      CONCAT(pc.capability_name, IF(ppc.capability_value IS NULL OR ppc.capability_value = '', '', CONCAT(': ', ppc.capability_value)))
                      ORDER BY pc.capability_name SEPARATOR '||')
               FROM platform_plan_capabilities ppc
               JOIN platform_capabilities pc ON pc.capability_code = ppc.capability_code
              WHERE ppc.plan_id = p.id) AS capability_names
       FROM platform_plans p
      WHERE p.status = 'active'
      ORDER BY FIELD(p.plan_tier, 'starter', 'standard', 'pro', 'advanced', 'enterprise') ASC, p.plan_code ASC`
  )

  const current = await queryRow<TenantSubscriptionRow>(
    `SELECT ts.id,
            ts.subscription_no,
            ts.plan_code,
            pp.plan_name,
            pp.plan_tier,
            ts.status,
            ts.source,
            ts.started_at,
            ts.ended_at,
            ts.current_order_id
       FROM tenant_subscriptions ts
       LEFT JOIN platform_plans pp ON pp.plan_code = ts.plan_code
      WHERE ts.tenant_code = ?
        AND ts.status = 'active'
      ORDER BY ts.updated_at DESC, ts.id DESC
      LIMIT 1`,
    [tenantCode]
  )

  const pendingOrder = await queryRow<OrderRow>(
    `SELECT o.order_no,
            o.plan_code,
            pp.plan_name,
            o.status,
            o.payment_method,
            o.total_amount,
            o.currency,
            o.placed_at,
            o.paid_at,
            o.effective_from,
            o.effective_until
       FROM platform_orders o
       LEFT JOIN platform_plans pp ON pp.plan_code = o.plan_code
      WHERE o.tenant_code = ?
        AND o.status = 'pending'
        AND o.payment_method = 'bank_transfer'
      ORDER BY o.placed_at DESC, o.id DESC
      LIMIT 1`,
    [tenantCode]
  )

  return ok({
    trialDays: TENANT_PLAN_TRIAL_DAYS,
    bankTransferAccount: {
      accountName: '汇智云平台收款账户（占位）',
      bankName: '开户银行（占位）',
      accountNo: '0000 0000 0000 0000',
      remark: '转账时请备注企业名称与订单号'
    },
    currentSubscription: current
      ? {
          id: current.id,
          subscriptionNo: current.subscription_no,
          planCode: current.plan_code,
          planName: current.plan_name,
          planTier: current.plan_tier,
          status: current.status,
          source: current.source,
          startedAt: current.started_at,
          endedAt: current.ended_at,
          currentOrderId: current.current_order_id
        }
      : null,
    pendingOrder: pendingOrder
      ? {
          orderNo: pendingOrder.order_no,
          planCode: pendingOrder.plan_code,
          planName: pendingOrder.plan_name,
          status: pendingOrder.status,
          paymentMethod: pendingOrder.payment_method,
          totalAmount: pendingOrder.total_amount !== null ? Number(pendingOrder.total_amount) : null,
          currency: pendingOrder.currency,
          placedAt: pendingOrder.placed_at,
          paidAt: pendingOrder.paid_at,
          effectiveFrom: pendingOrder.effective_from,
          effectiveUntil: pendingOrder.effective_until
        }
      : null,
    plans: plans.map(plan => ({
      id: plan.id,
      planCode: plan.plan_code,
      planName: plan.plan_name,
      planTier: plan.plan_tier,
      priceModel: plan.price_model,
      basePrice: plan.base_price !== null ? Number(plan.base_price) : null,
      currency: plan.currency,
      billingCycle: plan.billing_cycle,
      description: plan.description,
      appCount: Number(plan.app_count) || 0,
      appNames: splitList(plan.app_names),
      capabilityCount: Number(plan.capability_count) || 0,
      capabilityNames: splitList(plan.capability_names)
    }))
  })
})
