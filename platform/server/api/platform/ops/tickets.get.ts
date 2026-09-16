import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface TicketRow extends RowDataPacket {
  id: number
  ticket_no: string
  tenant_code: string | null
  tenant_name: string | null
  title: string
  category: string
  priority: string
  status: string
  reporter_contact: string | null
  assignee_uid: string | null
  assignee_name: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'all'
  const priority = normalizeNullableString(query.priority) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('tk.status = ?')
    params.push(status)
  }
  if (priority !== 'all') {
    where.push('tk.priority = ?')
    params.push(priority)
  }
  if (keyword) {
    where.push('(tk.ticket_no LIKE ? OR tk.title LIKE ? OR COALESCE(tk.tenant_code, \'\') LIKE ? OR COALESCE(t.display_name, t.tenant_name, \'\') LIKE ? OR COALESCE(tk.reporter_contact, \'\') LIKE ?)')
    params.push(...Array(5).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<TicketRow[]>(
    `SELECT tk.id,
            tk.ticket_no,
            tk.tenant_code,
            COALESCE(t.display_name, t.tenant_name) AS tenant_name,
            tk.title,
            tk.category,
            tk.priority,
            tk.status,
            tk.reporter_contact,
            assignee.uid AS assignee_uid,
            assignee.display_name AS assignee_name,
            tk.created_at,
            tk.updated_at,
            tk.closed_at
       FROM platform_tickets tk
       LEFT JOIN tenants t ON t.tenant_code = tk.tenant_code
       LEFT JOIN platform_accounts assignee ON assignee.id = tk.assignee_account_id
      ${whereSql}
      ORDER BY tk.updated_at DESC, tk.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_tickets tk
       LEFT JOIN tenants t ON t.tenant_code = tk.tenant_code
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      ticketNo: row.ticket_no,
      tenantCode: row.tenant_code,
      tenantName: row.tenant_name,
      title: row.title,
      category: row.category,
      priority: row.priority,
      status: row.status,
      reporterContact: row.reporter_contact,
      assigneeUid: row.assignee_uid,
      assigneeName: row.assignee_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
