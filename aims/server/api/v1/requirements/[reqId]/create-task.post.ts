/**
 * 为需求创建关联任务
 * POST /api/v1/requirements/:reqId/create-task
 * Body: { milestoneId, assigneeUid?, estimatedHours?, title? }
 *
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface CreateTaskResult {
  taskId: number
  itemKey: string
  title: string
  milestoneId: number
  status: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const body = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) || {}
  const data = await forwardAimsRuntimePost<CreateTaskResult>(
    event,
    `/v1/aims/requirements/${reqId}/create-task`,
    { uid, body }
  )

  return { code: 0, data }
})
