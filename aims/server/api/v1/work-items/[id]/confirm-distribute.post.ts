/**
 * 确认任务分配：审批通过后批量将 target 下所有 planning 态 matter 置为 todo
 * POST /api/v1/work-items/:id/confirm-distribute
 *
 * 调用时机：前端 usePageWorkflow 的 onApproved 回调。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface ConfirmDistributeResult {
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

  const data = await forwardAimsRuntimePost<ConfirmDistributeResult>(
    event,
    `/v1/aims/work-items/${targetId}/confirm-distribute`,
    { uid }
  )

  return { code: 0, data }
})
