import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface OrderRow extends RowDataPacket {
  id: number
  order_no: string
  tenant_code: string
  tenant_name: string | null
  display_name: string | null
  plan_code: string
  plan_name: string | null
  payment_method: string | null
  status: string
  total_amount: string | null
  currency: string | null
  placed_at: string
  paid_at: string | null
  effective_from: string | null
  effective_until: string | null
  created_by_account_id: number | null
  payment_no: string | null
  transaction_ref: string | null
  confirmed_by_account_id: number | null
  confirmed_by_uid: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
  notes: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const status = normalizeNullableString(query.status) || 'all'
  const paymentMethod = normalizeNullableString(query.paymentMethod) || 'all'
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('o.status = ?')
    params.push(status)
  }

  if (paymentMethod !== 'all') {
    where.push('o.payment_method = ?')
    params.push(paymentMethod)
  }

  if (keyword) {
    where.push('(o.order_no LIKE ? OR o.tenant_code LIKE ? OR COALESCE(t.tenant_name, \'\') LIKE ? OR o.plan_code LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<OrderRow[]>(
    `SELECT o.id,
            o.order_no,
            o.tenant_code,
            t.tenant_name,
            t.display_name,
            o.plan_code,
            p.plan_name,
            o.payment_method,
            o.status,
            o.total_amount,
            o.currency,
            o.placed_at,
            o.paid_at,
            o.effective_from,
            o.effective_until,
            o.created_by_account_id,
            pay.payment_no,
            pay.transaction_ref,
            pay.confirmed_by_account_id,
            confirmer.uid AS confirmed_by_uid,
            confirmer.display_name AS confirmed_by_name,
            pay.confirmed_at,
            o.notes
       FROM platform_orders o
       LEFT JOIN tenants t ON t.tenant_code = o.tenant_code
       LEFT JOIN platform_plans p ON p.plan_code = o.plan_code
       LEFT JOIN platform_payments pay
         ON pay.id = (
           SELECT pay2.id
             FROM platform_payments pay2
            WHERE pay2.order_id = o.id
            ORDER BY pay2.paid_at DESC, pay2.id DESC
            LIMIT 1
         )
       LEFT JOIN platform_accounts confirmer ON confirmer.id = pay.confirmed_by_account_id
      ${whereSql}
      ORDER BY o.placed_at DESC, o.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_orders o
       LEFT JOIN tenants t ON t.tenant_code = o.tenant_code
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      orderNo: row.order_no,
      tenantCode: row.tenant_code,
      tenantName: row.display_name || row.tenant_name,
      planCode: row.plan_code,
      planName: row.plan_name,
      paymentMethod: row.payment_method,
      status: row.status,
      totalAmount: row.total_amount !== null ? Number(row.total_amount) : null,
      currency: row.currency,
      placedAt: row.placed_at,
      paidAt: row.paid_at,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
      createdByAccountId: row.created_by_account_id,
      paymentNo: row.payment_no,
      bankTransactionNo: row.transaction_ref,
      confirmedByAccountId: row.confirmed_by_account_id,
      confirmedByUid: row.confirmed_by_uid,
      confirmedByName: row.confirmed_by_name,
      confirmedAt: row.confirmed_at,
      notes: row.notes
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
