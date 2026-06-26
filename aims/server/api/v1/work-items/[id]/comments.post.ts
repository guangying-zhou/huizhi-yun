/**
 * 添加工作项评论
 * POST /api/v1/work-items/:id/comments
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'

interface WorkItemRow extends RowDataPacket {
  id: number
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

  // 验证工作项存在
  const item = await queryRow<WorkItemRow>(
    'SELECT id FROM work_items WHERE id = ?',
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  const body = await readBody(event)
  if (!body?.content?.trim()) {
    throw createError({ statusCode: 400, message: '评论内容不能为空' })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO work_item_comments (work_item_id, author_uid, content)
     VALUES (?, ?, ?)`,
    [workItemId, uid, body.content.trim()]
  )

  return {
    code: 0,
    data: { id: result.insertId }
  }
})
