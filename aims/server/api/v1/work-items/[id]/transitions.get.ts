/**
 * 获取需求可用的状态转换
 * GET /api/v1/work-items/:id/transitions
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ItemRow extends RowDataPacket {
  project_id: number
  tier: string
  type: string
  status: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const item = await queryRow<ItemRow>(
    'SELECT project_id, tier, type, status FROM work_items WHERE id = ?',
    [id]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '需求不存在' })
  }

  const entityType = item.tier as string // target, matter 对应 workflow_transitions.entity_type
  const transitions = await getAvailableTransitions(item.project_id, entityType, item.status)

  return {
    code: 0,
    data: transitions
  }
})
