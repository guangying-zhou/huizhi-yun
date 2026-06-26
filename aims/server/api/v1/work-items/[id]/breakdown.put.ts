/**
 * 保存工作项任务分解
 * PUT /api/v1/work-items/:id/breakdown
 *
 * 归属模型（target_id / matter_id 拆分）、覆盖/唯一承接校验、工时校验等
 * 业务规则在 tenant-runtime 侧实现（data-runtime aims saveWorkItemBreakdown）。
 * 本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface BreakdownResult {
  ok: boolean
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

  const body = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) || {}
  const data = await forwardAimsRuntimePost<BreakdownResult>(
    event,
    `/v1/aims/work-items/${workItemId}/breakdown`,
    { uid, body, method: 'PUT' }
  )

  return { code: 0, data }
})
