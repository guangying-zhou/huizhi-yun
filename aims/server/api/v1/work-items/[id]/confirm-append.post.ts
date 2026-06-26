/**
 * 确认追加任务（审批通过回调）
 * POST /api/v1/work-items/:id/confirm-append
 *
 * 将当前 target 下所有 planning 态的追加子任务置为 todo。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface ConfirmAppendResult {
  targetId: number
  mattersUpdated: number
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

  const data = await forwardAimsRuntimePost<ConfirmAppendResult>(
    event,
    `/v1/aims/work-items/${targetId}/confirm-append`,
    { uid }
  )

  return { code: 0, data }
})
