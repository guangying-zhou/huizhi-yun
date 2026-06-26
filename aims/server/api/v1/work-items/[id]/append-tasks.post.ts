/**
 * 保存"追加任务"草稿
 * POST /api/v1/work-items/:id/append-tasks
 *
 * 仅在 target 已进入执行态时使用；保存为 planning，待审批通过后由 confirm-append 置为 todo。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface AppendTasksResult {
  ok: boolean
  createdIds: number[]
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
  const data = await forwardAimsRuntimePost<AppendTasksResult>(
    event,
    `/v1/aims/work-items/${workItemId}/append-tasks`,
    { uid, body }
  )

  return { code: 0, data }
})
