/**
 * 从当前"需求变更"工作项克隆一条新的变更实例
 * POST /api/v1/work-items/:id/clone-from-template
 *
 * 仅支持 template_key='requirement_change'；item_key 自增，不复制分解产物。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface CloneResult {
  id: number
  itemKey: string
  title: string
  round: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const sourceId = Number(getRouterParam(event, 'id'))
  if (!sourceId || Number.isNaN(sourceId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const data = await forwardAimsRuntimePost<CloneResult>(
    event,
    `/v1/aims/work-items/${sourceId}/clone-from-template`,
    { uid }
  )

  return { code: 0, data }
})
