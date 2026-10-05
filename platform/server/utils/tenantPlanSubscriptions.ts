import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

type TransactionExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export const TENANT_PLAN_TRIAL_DAYS = 30

export const PLAN_PAYMENT_METHODS = ['bank_transfer', 'wechat_pay', 'alipay'] as const

export type PlanPaymentMethod = typeof PLAN_PAYMENT_METHODS[number]

function normalizeCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase().slice(0, 24) || 'TENANT'
}

export function buildTenantPlanOrderNo(tenantCode: string) {
  return `ORD-${normalizeCode(tenantCode)}-${Date.now()}`
}

export function buildTenantPlanPaymentNo(tenantCode: string) {
  return `PAY-${normalizeCode(tenantCode)}-${Date.now()}`
}

export function buildTenantPlanSubscriptionNo(tenantCode: string) {
  return `TSUB-${normalizeCode(tenantCode)}-${Date.now()}`
}

export function isPlanPaymentMethod(value: string): value is PlanPaymentMethod {
  return PLAN_PAYMENT_METHODS.includes(value as PlanPaymentMethod)
}

export async function activateTenantPlanSubscription(
  tx: TransactionExecutor,
  input: {
    tenantCode: string
    planCode: string
    orderId: number
    accountId: number | null
    source?: string
    activatedAt?: string | null
    resetPeriod?: boolean
  }
) {
  const active = await tx.queryRow<RowDataPacket & { id: number, plan_code: string }>(
    `SELECT id, plan_code
     FROM tenant_subscriptions
     WHERE tenant_code = ?
       AND status = 'active'
     LIMIT 1
     FOR UPDATE`,
    [input.tenantCode]
  )

  const pending = await tx.queryRow<RowDataPacket & { id: number }>(
    `SELECT id
     FROM tenant_subscriptions
     WHERE tenant_code = ?
       AND current_order_id = ?
       AND status = 'pending'
     LIMIT 1
     FOR UPDATE`,
    [input.tenantCode, input.orderId]
  )

  if (active) {
    if (input.resetPeriod) {
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_subscriptions
         SET plan_code = ?,
             source = ?,
             started_at = COALESCE(?, UTC_TIMESTAMP()),
             ended_at = DATE_ADD(DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY), INTERVAL 1 YEAR),
             current_order_id = ?,
             created_by_account_id = COALESCE(created_by_account_id, ?),
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [input.planCode, input.source || 'self_service', input.activatedAt || null, input.activatedAt || null, input.orderId, input.accountId, active.id]
      )
    } else {
      const isRenewal = active.plan_code === input.planCode
      const endedAtExpr = isRenewal
        ? `DATE_ADD(GREATEST(COALESCE(ended_at, UTC_TIMESTAMP()), UTC_TIMESTAMP()), INTERVAL 1 YEAR)`
        : `CASE
               WHEN ended_at IS NULL OR ended_at < UTC_TIMESTAMP()
                 THEN DATE_ADD(DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY), INTERVAL 1 YEAR)
               ELSE ended_at
             END`
      const endedAtParams = isRenewal ? [] : [input.activatedAt || null]
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_subscriptions
         SET plan_code = ?,
             source = ?,
             started_at = COALESCE(started_at, COALESCE(?, UTC_TIMESTAMP())),
             ended_at = ${endedAtExpr},
             current_order_id = ?,
             created_by_account_id = COALESCE(created_by_account_id, ?),
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [input.planCode, input.source || 'self_service', input.activatedAt || null, ...endedAtParams, input.orderId, input.accountId, active.id]
      )
    }

    if (pending && pending.id !== active.id) {
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_subscriptions
         SET status = 'ended',
             ended_at = COALESCE(ended_at, UTC_TIMESTAMP()),
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [pending.id]
      )
    }

    return active.id
  }

  if (pending) {
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_subscriptions
       SET plan_code = ?,
           status = 'active',
           source = ?,
           started_at = COALESCE(?, UTC_TIMESTAMP()),
           ended_at = DATE_ADD(DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY), INTERVAL 1 YEAR),
           current_order_id = ?,
           created_by_account_id = COALESCE(created_by_account_id, ?),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [input.planCode, input.source || 'self_service', input.activatedAt || null, input.activatedAt || null, input.orderId, input.accountId, pending.id]
    )

    return pending.id
  }

  const inserted = await tx.execute<ResultSetHeader>(
    `INSERT INTO tenant_subscriptions
     (subscription_no, tenant_code, plan_code, status, source, started_at, ended_at,
       current_order_id, created_by_account_id, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, COALESCE(?, UTC_TIMESTAMP()),
       DATE_ADD(DATE_ADD(COALESCE(?, UTC_TIMESTAMP()), INTERVAL ${TENANT_PLAN_TRIAL_DAYS} DAY), INTERVAL 1 YEAR),
       ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      buildTenantPlanSubscriptionNo(input.tenantCode),
      input.tenantCode,
      input.planCode,
      input.source || 'self_service',
      input.activatedAt || null,
      input.activatedAt || null,
      input.orderId,
      input.accountId
    ]
  )

  return inserted.insertId
}
