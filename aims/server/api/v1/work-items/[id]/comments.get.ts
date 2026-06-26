/**
 * 获取工作项评论列表（分页）
 * GET /api/v1/work-items/:id/comments?page=&pageSize=
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface CommentRow extends RowDataPacket {
  id: number
  work_item_id: number
  author_uid: string
  content: string
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  const countRow = await queryRow<CountRow>(
    'SELECT COUNT(*) AS total FROM work_item_comments WHERE work_item_id = ?',
    [workItemId]
  )
  const total = countRow?.total || 0

  const rows = await queryRows<CommentRow[]>(
    `SELECT * FROM work_item_comments
     WHERE work_item_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [workItemId, pageSize, offset]
  )

  return {
    code: 0,
    data: {
      items: rows.map(row => ({
        id: row.id,
        workItemId: row.work_item_id,
        authorUid: row.author_uid,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total,
      page,
      pageSize
    }
  }
})
