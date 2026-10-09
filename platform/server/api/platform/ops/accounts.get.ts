import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface AccountRow extends RowDataPacket {
  id: number
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
  mfa_enabled: number
  status: string
  last_login_at: string | null
  roles: string | null
  created_at: string
}

interface CountRow extends RowDataPacket { total: number }

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('pa.status = ?')
    params.push(status)
  }
  if (keyword) {
    where.push('(pa.uid LIKE ? OR pa.username LIKE ? OR pa.email LIKE ? OR pa.display_name LIKE ?)')
    params.push(...Array(4).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<AccountRow[]>(
    `SELECT pa.id,
            pa.uid,
            pa.username,
            pa.email,
            pa.display_name,
            pa.account_type,
            pa.mfa_enabled,
            pa.status,
            pa.last_login_at,
            pa.created_at,
            GROUP_CONCAT(DISTINCT pr.role_name ORDER BY pr.role_name SEPARATOR ', ') AS roles
       FROM platform_accounts pa
       LEFT JOIN platform_account_roles par
         ON par.account_id = pa.id
        AND (par.expired_at IS NULL OR par.expired_at > NOW())
       LEFT JOIN platform_roles pr ON pr.id = par.role_id AND pr.status = 'active'
      ${whereSql}
      GROUP BY pa.id
      ORDER BY pa.updated_at DESC, pa.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total FROM platform_accounts pa ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      uid: row.uid,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      accountType: row.account_type,
      mfaEnabled: Boolean(row.mfa_enabled),
      status: row.status,
      roles: row.roles ? row.roles.split(', ') : [],
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
