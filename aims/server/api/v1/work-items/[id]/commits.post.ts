/**
 * 关联 GitLab 提交到工作项
 * POST /api/v1/work-items/:id/commits
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface WorkItemRow extends RowDataPacket {
  project_id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const body = await readBody<{ commitId: number }>(event)
  if (!body.commitId) {
    throw createError({ statusCode: 400, message: '请选择要关联的提交' })
  }

  const item = await queryRow<WorkItemRow>(
    'SELECT project_id FROM work_items WHERE id = ?',
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  await execute(
    'UPDATE gitlab_commits SET work_item_id = ? WHERE id = ? AND project_id = ?',
    [workItemId, body.commitId, item.project_id]
  )

  return { code: 0, data: null }
})
