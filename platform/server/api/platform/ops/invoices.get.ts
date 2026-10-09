import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface InvoiceRow extends RowDataPacket {
  id: number
  invoice_no: string
  order_no: string
  tenant_code: string
  tenant_name: string | null
  amount: string
  currency: string
  status: string
  issued_at: string
  paid_at: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('i.status = ?')
    params.push(status)
  }
  if (keyword) {
    where.push('(i.invoice_no LIKE ? OR o.order_no LIKE ? OR i.tenant_code LIKE ? OR COALESCE(t.display_name, t.tenant_name, \'\') LIKE ?)')
    params.push(...Array(4).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<InvoiceRow[]>(
    `SELECT i.id,
            i.invoice_no,
            o.order_no,
            i.tenant_code,
            COALESCE(t.display_name, t.tenant_name) AS tenant_name,
            i.amount,
            i.currency,
            i.status,
            i.issued_at,
            i.paid_at
       FROM platform_invoices i
       INNER JOIN platform_orders o ON o.id = i.order_id
       LEFT JOIN tenants t ON t.tenant_code = i.tenant_code
      ${whereSql}
      ORDER BY i.issued_at DESC, i.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_invoices i
       INNER JOIN platform_orders o ON o.id = i.order_id
       LEFT JOIN tenants t ON t.tenant_code = i.tenant_code
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      invoiceNo: row.invoice_no,
      orderNo: row.order_no,
      tenantCode: row.tenant_code,
      tenantName: row.tenant_name,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      issuedAt: row.issued_at,
      paidAt: row.paid_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
