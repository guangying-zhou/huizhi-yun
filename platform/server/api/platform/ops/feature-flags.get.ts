import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface FeatureFlagRow extends RowDataPacket {
  id: number
  flag_code: string
  flag_name: string
  description: string | null
  default_value_json: unknown
  status: string
  assignment_count: number
  updated_at: string
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
    where.push('ff.status = ?')
    params.push(status)
  }
  if (keyword) {
    where.push('(ff.flag_code LIKE ? OR ff.flag_name LIKE ? OR COALESCE(ff.description, \'\') LIKE ?)')
    params.push(...Array(3).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<FeatureFlagRow[]>(
    `SELECT ff.id,
            ff.flag_code,
            ff.flag_name,
            ff.description,
            ff.default_value_json,
            ff.status,
            ff.updated_at,
            COUNT(ffa.id) AS assignment_count
       FROM platform_feature_flags ff
       LEFT JOIN platform_feature_flag_assignments ffa ON ffa.flag_id = ff.id
      ${whereSql}
      GROUP BY ff.id
      ORDER BY ff.updated_at DESC, ff.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total FROM platform_feature_flags ff ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      flagCode: row.flag_code,
      flagName: row.flag_name,
      description: row.description,
      defaultValue: row.default_value_json,
      status: row.status,
      assignmentCount: Number(row.assignment_count || 0),
      updatedAt: row.updated_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
