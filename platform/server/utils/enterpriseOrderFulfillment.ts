import { requireApprovedEnterpriseOrderAcceptance } from './enterpriseOrderApproval.ts'
import { createHash } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { TransactionExecutor } from './db'
import type { EnterpriseTransaction } from './enterpriseEntitlementRepository.ts'
import { ENTERPRISE_ENTITLEMENT_SCHEMA, ENTERPRISE_PRODUCT_CODE, enterpriseStatusAt, normalizeEnterprisePeriod, parseEntitlementUtc, type EnterpriseEntitlement, type EnterprisePeriod } from './enterpriseEntitlement.ts'

type Row = RowDataPacket & Record<string, unknown>
function orderUtc(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('enterprise_order_period_required')
  const result = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return new Date(parseEntitlementUtc(result)).toISOString()
}
export function entitlementPeriodForConfirmedOrder(current: EnterpriseEntitlement | null, orderPeriod: EnterprisePeriod, now: string): EnterprisePeriod {
  const order = normalizeEnterprisePeriod(orderPeriod)
  if (!current || enterpriseStatusAt(current, now) === 'expired') return order
  const existing = normalizeEnterprisePeriod(current)
  if (existing.end.kind !== 'finite' || order.end.kind !== 'finite') throw new Error('enterprise_order_period_review_required')
  if (parseEntitlementUtc(order.effectiveFrom) > parseEntitlementUtc(existing.end.effectiveUntil)) throw new Error('enterprise_order_period_gap')
  if (parseEntitlementUtc(order.end.effectiveUntil) <= parseEntitlementUtc(existing.end.effectiveUntil)) throw new Error('enterprise_order_does_not_extend_period')
  // Union only continuous/overlapping evidenced periods; never add a trial/year or fill a gap.
  return { effectiveFrom: parseEntitlementUtc(order.effectiveFrom) < parseEntitlementUtc(existing.effectiveFrom) ? order.effectiveFrom : existing.effectiveFrom, end: order.end }
}

/** Caller owns transaction and must lock tenant before order; does not create/alter payments. */
export async function fulfillEnterpriseOrderInTransaction(tx: TransactionExecutor, input: { tenantCode: string, orderId: number, actorUid: string }, now: string) {
  parseEntitlementUtc(now)
  if (!input.actorUid.trim() || !input.tenantCode.trim() || !Number.isSafeInteger(input.orderId) || input.orderId < 1) throw new Error('invalid_enterprise_order_fulfillment')
  const tenant = await tx.queryRow<Row>('SELECT tenant_code, status FROM tenants WHERE tenant_code = ? FOR UPDATE', [input.tenantCode])
  if (!tenant) throw new Error('enterprise_tenant_not_found')
  const order = await tx.queryRow<Row>('SELECT id, order_no, tenant_code, plan_code, status, effective_from, effective_until, total_amount, currency, paid_at FROM platform_orders WHERE id = ? AND tenant_code = ? FOR UPDATE', [input.orderId, input.tenantCode])
  if (!order) throw new Error('enterprise_order_not_found')
  if (order.plan_code !== ENTERPRISE_PRODUCT_CODE) throw new Error('enterprise_order_product_mismatch')
  if (order.status !== 'paid') throw new Error('enterprise_order_not_confirmed')
  await requireApprovedEnterpriseOrderAcceptance(tx.queryRow, order)
  const payments = await tx.queryRows<Row[]>('SELECT id, status, amount, currency, tenant_code, paid_at, transaction_ref, confirmed_by_account_id FROM platform_payments WHERE order_id = ? ORDER BY id FOR UPDATE', [input.orderId])
  const successful = payments.filter(payment => payment.status === 'succeeded')
  // Exact decimal comparison stays in SQL; floating point cannot decide payment sufficiency.
  const settled = await tx.queryRow<Row>(`SELECT COALESCE(SUM(amount), 0) >= ? AND ? >= 0 AS covered FROM platform_payments WHERE order_id = ? AND tenant_code = ? AND currency = ? AND status = 'succeeded'`, [order.total_amount, order.total_amount, input.orderId, input.tenantCode, order.currency])
  if (!String(order.currency || '').trim() || !successful.length || successful.some(payment => payment.tenant_code !== input.tenantCode || payment.currency !== order.currency) || !Number(settled?.covered)) throw new Error('enterprise_order_payment_evidence_required')
  const period: EnterprisePeriod = { effectiveFrom: orderUtc(order.effective_from), end: { kind: 'finite', effectiveUntil: orderUtc(order.effective_until) } }
  normalizeEnterprisePeriod(period)
  const sourceHash = `sha256_${createHash('sha256').update(JSON.stringify({ order, payments })).digest('hex')}`
  const receipt = await tx.queryRow<Row>('SELECT source_hash, result_json FROM tenant_enterprise_order_fulfillments WHERE tenant_code = ? AND order_id = ? FOR UPDATE', [input.tenantCode, input.orderId])
  if (receipt) {
    if (receipt.source_hash !== sourceHash) throw new Error('enterprise_order_source_conflict')
    return { replayed: true, entitlement: typeof receipt.result_json === 'string' ? JSON.parse(receipt.result_json) as EnterpriseEntitlement : receipt.result_json as EnterpriseEntitlement }
  }
  const row = await tx.queryRow<Row>('SELECT c.revision, e.entitlement_json FROM tenant_enterprise_entitlement_current c INNER JOIN tenant_enterprise_entitlements e ON e.tenant_code = c.tenant_code AND e.revision = c.revision WHERE c.tenant_code = ? FOR UPDATE', [input.tenantCode])
  const current = row ? (typeof row.entitlement_json === 'string' ? JSON.parse(row.entitlement_json) : row.entitlement_json) as EnterpriseEntitlement : null
  if (current && (current.tenantCode !== input.tenantCode || current.revision !== Number(row?.revision))) throw new Error('entitlement_stored_context_invalid')
  if (!current) {
    const legacy = await tx.queryRows<Row[]>('SELECT id, current_order_id FROM tenant_subscriptions WHERE tenant_code = ? AND status IN (\'active\', \'suspended\') FOR UPDATE', [input.tenantCode])
    if (legacy.some(subscription => Number(subscription.current_order_id) !== input.orderId)) throw new Error('enterprise_order_legacy_conversion_required')
  }
  const revision = Number(row?.revision || 0) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('invalid_entitlement_revision')
  const nextPeriod = entitlementPeriodForConfirmedOrder(current, period, now)
  let status: EnterpriseEntitlement['status'] = current?.status === 'revoked' || tenant.status === 'revoked' ? 'revoked' : current?.status === 'suspended' || tenant.status !== 'active' ? 'suspended' : 'active'
  const next: EnterpriseEntitlement = { ...nextPeriod, tenantCode: input.tenantCode, revision, schemaVersion: ENTERPRISE_ENTITLEMENT_SCHEMA, productCode: ENTERPRISE_PRODUCT_CODE, status }
  status = enterpriseStatusAt(next, now)
  next.status = status
  await tx.execute<ResultSetHeader>('INSERT INTO tenant_enterprise_entitlements (tenant_code, revision, schema_version, product_code, status, effective_from, effective_until, period_kind, entitlement_json, migration_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [input.tenantCode, revision, next.schemaVersion, next.productCode, next.status, next.effectiveFrom.replace('T', ' ').replace('Z', ''), next.end.kind === 'finite' ? next.end.effectiveUntil.replace('T', ' ').replace('Z', '') : null, next.end.kind, JSON.stringify(next), `order:${input.orderId}`])
  await tx.execute<ResultSetHeader>('INSERT INTO tenant_enterprise_entitlement_current (tenant_code, revision) VALUES (?, ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision)', [input.tenantCode, revision])
  await tx.execute<ResultSetHeader>('INSERT INTO tenant_enterprise_order_fulfillments (tenant_code, order_id, source_hash, actor_uid, previous_revision, result_revision, order_from, order_until, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [input.tenantCode, input.orderId, sourceHash, input.actorUid, revision - 1, revision, period.effectiveFrom.replace('T', ' ').replace('Z', ''), period.end.kind === 'finite' ? period.end.effectiveUntil.replace('T', ' ').replace('Z', '') : null, JSON.stringify(next)])
  return { replayed: false, entitlement: next }
}

export function createEnterpriseOrderFulfillmentRepository(withTransaction: EnterpriseTransaction) {
  return { fulfill: (input: { tenantCode: string, orderId: number, actorUid: string }, now = new Date().toISOString()) => withTransaction(tx => fulfillEnterpriseOrderInTransaction(tx, input, now)) }
}

export async function fulfillConfirmedEnterpriseOrder(input: { tenantCode: string, orderId: number, actorUid: string }, now = new Date().toISOString()) {
  const { withTransaction } = await import('./db')
  return createEnterpriseOrderFulfillmentRepository(withTransaction).fulfill(input, now)
}

/** Existing bank-transfer confirmation route calls this only for enterprise-full orders. */
export async function confirmEnterpriseOrderPayment(input: { tenantCode: string, orderId: number, actorUid: string, accountId: number | null, bankTransactionNo: string, paidAt: string }) {
  const { withTransaction } = await import('./db')
  return withTransaction(async (tx) => {
    const tenant = await tx.queryRow<Row>('SELECT tenant_code FROM tenants WHERE tenant_code = ? FOR UPDATE', [input.tenantCode])
    if (!tenant) throw new Error('enterprise_tenant_not_found')
    const order = await tx.queryRow<Row>('SELECT id, order_no, tenant_code, plan_code, status, payment_method, total_amount, currency, effective_from, effective_until FROM platform_orders WHERE id = ? AND tenant_code = ? FOR UPDATE', [input.orderId, input.tenantCode])
    if (!order || order.plan_code !== ENTERPRISE_PRODUCT_CODE) throw new Error('enterprise_order_product_mismatch')
    await requireApprovedEnterpriseOrderAcceptance(tx.queryRow, order)
    if (order.status !== 'paid') {
      if (order.status !== 'pending' || order.payment_method !== 'bank_transfer' || !input.bankTransactionNo.trim()) throw new Error('enterprise_order_confirmation_invalid')
      normalizeEnterprisePeriod({ effectiveFrom: orderUtc(order.effective_from), end: { kind: 'finite', effectiveUntil: orderUtc(order.effective_until) } })
      const paidAt = orderUtc(input.paidAt).replace('T', ' ').replace('Z', '')
      // Existing approved order price/period are immutable in this operation.
      await tx.execute<ResultSetHeader>('UPDATE platform_orders SET status = \'paid\', paid_at = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND tenant_code = ?', [paidAt, input.orderId, input.tenantCode])
      await tx.execute<ResultSetHeader>('INSERT INTO platform_payments (payment_no, order_id, invoice_id, tenant_code, amount, currency, method, status, transaction_ref, paid_at, confirmed_by_account_id, confirmed_at, created_at) VALUES (?, ?, NULL, ?, ?, ?, \'bank_transfer\', \'succeeded\', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())', [`EPAY-${input.orderId}`, input.orderId, input.tenantCode, order.total_amount, order.currency, input.bankTransactionNo, paidAt, input.accountId])
    }
    const result = await fulfillEnterpriseOrderInTransaction(tx, input, new Date().toISOString())
    return { orderNo: order.order_no, status: 'paid', ...result }
  })
}
