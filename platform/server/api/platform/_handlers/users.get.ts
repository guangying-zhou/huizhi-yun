import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface UserRow extends RowDataPacket {
  id: number
  tenant_code: string
  uid: string
  display_name: string | null
  external_ref: string | null
  status: string
  source_type: string
  last_login_at: string | null
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

function fromSql() {
  return 'FROM tenant_subjects ts'
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const status = normalizeNullableString(query.status)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['ts.tenant_code = ?', 'ts.subject_type = \'user\'']
  const params: Array<string | number> = [tenantCode]

  if (status) {
    where.push('ts.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(ts.subject_code LIKE ? OR COALESCE(ts.display_name, "") LIKE ? OR COALESCE(ts.external_ref, "") LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const from = fromSql()

  const items = await queryRows<UserRow[]>(
    `SELECT ts.id, ts.tenant_code, ts.subject_code AS uid,
            ts.display_name, ts.external_ref, ts.status,
            COALESCE((
              SELECT tip.provider_type
              FROM tenant_subject_identities tsi
              INNER JOIN tenant_identity_providers tip
                ON tip.id = tsi.provider_id
               AND tip.tenant_code = tsi.tenant_code
              WHERE tsi.tenant_code = ts.tenant_code
                AND tsi.subject_id = ts.id
                AND tsi.status = 'active'
                AND tip.status = 'active'
              ORDER BY tsi.id ASC
              LIMIT 1
            ), 'manual') AS source_type,
            (
              SELECT MAX(COALESCE(sess.refreshed_at, sess.issued_at))
              FROM tenant_sessions sess
              WHERE sess.tenant_code = ts.tenant_code
                AND sess.subject_id = ts.id
            ) AS last_login_at,
            ts.created_at, ts.updated_at
     ${from}
     ${whereSql}
     ORDER BY COALESCE(ts.display_name, ts.subject_code) ASC, ts.subject_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     ${from}
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      uid: item.uid,
      username: item.external_ref,
      displayName: item.display_name || item.uid,
      email: null,
      mobile: null,
      avatarUrl: null,
      status: item.status,
      sourceType: item.source_type,
      lastLoginAt: item.last_login_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
