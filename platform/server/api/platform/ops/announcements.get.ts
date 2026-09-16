import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface AnnouncementRow extends RowDataPacket {
  id: number
  title: string
  content: string
  audience_type: string
  audience_value: string | null
  severity: string
  status: string
  published_at: string | null
  expired_at: string | null
  creator_uid: string | null
  creator_name: string | null
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const status = normalizeNullableString(query.status) || 'all'
  const severity = normalizeNullableString(query.severity) || 'all'
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['1 = 1']
  const params: Array<string | number> = []

  if (status !== 'all') {
    where.push('a.status = ?')
    params.push(status)
  }
  if (severity !== 'all') {
    where.push('a.severity = ?')
    params.push(severity)
  }
  if (keyword) {
    where.push('(a.title LIKE ? OR a.content LIKE ? OR COALESCE(a.audience_value, \'\') LIKE ?)')
    params.push(...Array(3).fill(`%${keyword}%`))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<AnnouncementRow[]>(
    `SELECT a.id,
            a.title,
            a.content,
            a.audience_type,
            a.audience_value,
            a.severity,
            a.status,
            a.published_at,
            a.expired_at,
            creator.uid AS creator_uid,
            creator.display_name AS creator_name,
            a.created_at,
            a.updated_at
       FROM platform_announcements a
       LEFT JOIN platform_accounts creator ON creator.id = a.created_by_account_id
      ${whereSql}
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM platform_announcements a
      ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      audienceType: row.audience_type,
      audienceValue: row.audience_value,
      severity: row.severity,
      status: row.status,
      publishedAt: row.published_at,
      expiredAt: row.expired_at,
      creatorUid: row.creator_uid,
      creatorName: row.creator_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    total: Number(totalRow?.total || 0),
    page,
    pageSize
  })
})
