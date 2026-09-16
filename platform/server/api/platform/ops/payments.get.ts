import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface PaymentRow extends RowDataPacket {
  id: number
  payment_no: string
  order_no: string
  invoice_no: string | null
  tenant_code: string
  tenant_name: string | null
  amount: string
  currency: string
  method: string
  status: string
  transaction_ref: string | null
  paid_at: string
  confirmed_at: string | null
  confirmed_by_uid: string | null
  confirmed_by_name: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'all'
  const method = normalizeNullableString(query.method) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('p.status = ?')
    params.push(status)
  }
  if (method !== 'all') {
    where.push('p.method = ?')
    params.push(method)
  }
  if (keyword) {
    where.push('(p.payment_no LIKE ? OR COALESCE(p.transaction_ref, \'\') LIKE ? OR o.order_no LIKE ? OR p.tenant_code LIKE ? OR COALESCE(t.display_name, t.tenant_name, \'\') LIKE ?)')
    params.push(...Array(5).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<PaymentRow[]>(
    `SELECT p.id,
            p.payment_no,
            o.order_no,
            i.invoice_no,
            p.tenant_code,
            COALESCE(t.display_name, t.tenant_name) AS tenant_name,
            p.amount,
            p.currency,
            p.method,
            p.status,
            p.transaction_ref,
            p.paid_at,
            p.confirmed_at,
            confirmer.uid AS confirmed_by_uid,
            confirmer.display_name AS confirmed_by_name
       FROM platform_payments p
       INNER JOIN platform_orders o ON o.id = p.order_id
       LEFT JOIN platform_invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.tenant_code = p.tenant_code
       LEFT JOIN platform_accounts confirmer ON confirmer.id = p.confirmed_by_account_id
      ${whereSql}
      ORDER BY p.paid_at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_payments p
       INNER JOIN platform_orders o ON o.id = p.order_id
       LEFT JOIN tenants t ON t.tenant_code = p.tenant_code
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      paymentNo: row.payment_no,
      orderNo: row.order_no,
      invoiceNo: row.invoice_no,
      tenantCode: row.tenant_code,
      tenantName: row.tenant_name,
      amount: Number(row.amount),
      currency: row.currency,
      method: row.method,
      status: row.status,
      transactionRef: row.transaction_ref,
      paidAt: row.paid_at,
      confirmedAt: row.confirmed_at,
      confirmedByUid: row.confirmed_by_uid,
      confirmedByName: row.confirmed_by_name
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
