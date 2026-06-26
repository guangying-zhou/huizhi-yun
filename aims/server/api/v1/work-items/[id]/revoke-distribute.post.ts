/**
 * 撤回任务分配：把 target 下所有 todo 态 matter 回 planning
 * POST /api/v1/work-items/:id/revoke-distribute
 *
 * 严格模式：任一子 matter 不在 todo 则拒绝（409），避免破坏执行中状态。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface RevokeDistributeResult {
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

  const data = await forwardAimsRuntimePost<RevokeDistributeResult>(
    event,
    `/v1/aims/work-items/${targetId}/revoke-distribute`,
    { uid }
  )

  return { code: 0, data }
})
