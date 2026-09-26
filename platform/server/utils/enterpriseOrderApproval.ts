import { createHash } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { EnterpriseTransaction } from './enterpriseEntitlementRepository.ts'
import { normalizeEnterprisePeriod } from './enterpriseEntitlement.ts'

type Row = RowDataPacket & Record<string, unknown>
export interface EnterpriseApprovedOrderInput {
  tenantCode: string
  requestId: string
  approvalReference: string
  effectiveFrom: string
  effectiveUntil: string
  amount: string
  currency: string
  actorUid: string
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || [...value].some(character => character.charCodeAt(0) < 32)) throw new Error('enterprise_order_approval_input_invalid')
  return value.trim()
}
export function normalizeEnterpriseApprovedOrder(input: EnterpriseApprovedOrderInput) {
  const period = normalizeEnterprisePeriod({ effectiveFrom: input.effectiveFrom, end: { kind: 'finite', effectiveUntil: input.effectiveUntil } })
  if (period.end.kind !== 'finite') throw new Error('enterprise_order_approval_period_invalid')
  if (Date.parse(period.effectiveFrom) % 1000 !== 0 || Date.parse(period.end.effectiveUntil) % 1000 !== 0) throw new Error('enterprise_order_approval_second_precision_required')
  if (typeof input.amount !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input.amount)) throw new Error('enterprise_order_approval_amount_invalid')
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('enterprise_order_approval_currency_invalid')
  const [whole, fraction = ''] = input.amount.split('.')
  return { tenantCode: text(input.tenantCode, 64), requestId: text(input.requestId, 128), approvalReference: text(input.approvalReference, 255),
    effectiveFrom: period.effectiveFrom, effectiveUntil: period.end.effectiveUntil, amount: `${whole}.${fraction.padEnd(2, '0')}`, currency: input.currency, actorUid: text(input.actorUid, 128) }
}
function parse(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function sqlUtc(value: string) {
  return value.replace('T', ' ').replace('Z', '')
}
function orderUtc(value: unknown) {
  const raw = String(value)
  return new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`).toISOString()
}
export function assertEnterpriseApprovalMatchesOrder(approved: ReturnType<typeof normalizeEnterpriseApprovedOrder>, order: Row) {
  if (String(order.tenant_code) !== approved.tenantCode || order.plan_code !== 'enterprise-full' || String(order.total_amount) !== approved.amount || order.currency !== approved.currency || orderUtc(order.effective_from) !== new Date(approved.effectiveFrom).toISOString() || orderUtc(order.effective_until) !== new Date(approved.effectiveUntil).toISOString()) throw new Error('enterprise_order_approval_source_conflict')
}
export function createEnterpriseOrderApprovalRepository(withTransaction: EnterpriseTransaction) {
  return {
    async create(input: EnterpriseApprovedOrderInput) {
      const approved = normalizeEnterpriseApprovedOrder(input)
      const requestHash = createHash('sha256').update(JSON.stringify(approved)).digest('hex')
      return withTransaction(async (tx) => {
        const tenant = await tx.queryRow<Row>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [approved.tenantCode])
        if (!tenant) throw new Error('enterprise_order_tenant_not_found')
        const prior = await tx.queryRow<Row>('SELECT order_id,request_hash FROM enterprise_order_approvals WHERE tenant_code=? AND request_id=? FOR UPDATE', [approved.tenantCode, approved.requestId])
        if (prior) {
          if (prior.request_hash !== requestHash) throw new Error('enterprise_order_approval_idempotency_conflict')
          const order = await tx.queryRow<Row>('SELECT order_no FROM platform_orders WHERE id=? AND tenant_code=?', [prior.order_id, approved.tenantCode])
          if (!order) throw new Error('enterprise_order_approval_source_conflict')
          return { orderId: Number(prior.order_id), orderNo: String(order.order_no), replayed: true }
        }
        const orderNo = `EF-${createHash('sha256').update(`${approved.tenantCode}:${approved.requestId}`).digest('hex').slice(0, 40)}`
        const result = await tx.execute<ResultSetHeader>(`INSERT INTO platform_orders (order_no,tenant_code,plan_code,total_amount,currency,payment_method,status,effective_from,effective_until,placed_at,notes,created_at,updated_at)
          VALUES (?,?,'enterprise-full',?,?,'bank_transfer','pending',?,?,UTC_TIMESTAMP(),?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`, [orderNo, approved.tenantCode, approved.amount, approved.currency, sqlUtc(approved.effectiveFrom), sqlUtc(approved.effectiveUntil), `运营批准报价：${approved.approvalReference}`])
        await tx.execute<ResultSetHeader>('INSERT INTO enterprise_order_approvals (tenant_code,request_id,order_id,request_hash,approval_reference,approved_by_uid,approved_json) VALUES (?,?,?,?,?,?,?)', [approved.tenantCode, approved.requestId, result.insertId, requestHash, approved.approvalReference, approved.actorUid, JSON.stringify(approved)])
        return { orderId: result.insertId, orderNo, replayed: false }
      })
    },
    async accept(input: { tenantCode: string, orderNo: string, actorUid: string }) {
      const tenantCode = text(input.tenantCode, 64), orderNo = text(input.orderNo, 64), actorUid = text(input.actorUid, 128)
      return withTransaction(async (tx) => {
        await tx.queryRow<Row>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [tenantCode])
        const order = await tx.queryRow<Row>('SELECT * FROM platform_orders WHERE tenant_code=? AND order_no=? FOR UPDATE', [tenantCode, orderNo])
        if (!order) throw new Error('enterprise_order_not_found')
        const approval = await tx.queryRow<Row>('SELECT approved_json,request_hash FROM enterprise_order_approvals WHERE tenant_code=? AND order_id=?', [tenantCode, order.id])
        if (!approval) throw new Error('enterprise_order_approval_required')
        assertEnterpriseApprovalMatchesOrder(parse(approval.approved_json), order)
        const previous = await tx.queryRow<Row>('SELECT approval_hash FROM enterprise_order_acceptances WHERE order_id=?', [order.id])
        if (previous) {
          if (previous.approval_hash !== approval.request_hash) throw new Error('enterprise_order_approval_source_conflict')
          return { orderNo, replayed: true }
        }
        if (order.status !== 'pending') throw new Error('enterprise_order_acceptance_status_invalid')
        await tx.execute<ResultSetHeader>('INSERT INTO enterprise_order_acceptances (order_id,tenant_code,approval_hash,accepted_by_uid) VALUES (?,?,?,?)', [order.id, tenantCode, approval.request_hash, actorUid])
        return { orderNo, replayed: false }
      })
    }
  }
}
export async function createApprovedEnterpriseOrder(input: EnterpriseApprovedOrderInput) {
  const { withTransaction } = await import('./db')
  return createEnterpriseOrderApprovalRepository(withTransaction).create(input)
}
export async function acceptApprovedEnterpriseOrder(input: { tenantCode: string, orderNo: string, actorUid: string }) {
  const { withTransaction } = await import('./db')
  return createEnterpriseOrderApprovalRepository(withTransaction).accept(input)
}

export async function requireApprovedEnterpriseOrderAcceptance(query: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>, order: Row) {
  const approval = await query<Row>('SELECT request_hash,approved_json FROM enterprise_order_approvals WHERE order_id=? AND tenant_code=?', [order.id, order.tenant_code])
  if (!approval) return // Previously approved historical orders retain their existing fulfillment contract.
  const approved = normalizeEnterpriseApprovedOrder(parse(approval.approved_json))
  if (createHash('sha256').update(JSON.stringify(approved)).digest('hex') !== approval.request_hash) throw new Error('enterprise_order_approval_source_conflict')
  assertEnterpriseApprovalMatchesOrder(approved, order)
  const acceptance = await query<Row>('SELECT approval_hash FROM enterprise_order_acceptances WHERE order_id=? AND tenant_code=?', [order.id, order.tenant_code])
  if (!acceptance || acceptance.approval_hash !== approval.request_hash) throw new Error('enterprise_order_acceptance_required')
}
