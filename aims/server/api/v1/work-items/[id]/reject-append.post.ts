/**
 * 拒绝追加任务（审批拒绝回调）
 * POST /api/v1/work-items/:id/reject-append
 *
 * 清理当前 target 下所有 planning 态的追加子任务草稿。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface RejectAppendResult {
  targetId: number
  removed: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const targetId = Number(getRouterParam(event, 'id'))
  if (!targetId || Number.isNaN(targetId)) {
    throw createError({ statusCode: 400, message: '无效的目标ID' })
  }

  const data = await forwardAimsRuntimePost<RejectAppendResult>(
    event,
    `/v1/aims/work-items/${targetId}/reject-append`,
    { uid }
  )

  return { code: 0, data }
})
