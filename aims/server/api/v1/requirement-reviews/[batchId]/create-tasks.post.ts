/**
 * 为已通过的需求评审批次批量生成任务
 * POST /api/v1/requirement-reviews/:batchId/create-tasks
 *
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface CreateTasksResult {
  batchId: number
  title: string
  createdCount: number
  skippedCount: number
  created: Array<{ requirementId: number, taskId: number, itemKey: string }>
  skipped: Array<{ requirementId: number, reason: string, message: string }>
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const batchId = Number(getRouterParam(event, 'batchId'))
  if (!batchId || Number.isNaN(batchId)) {
    throw createError({ statusCode: 400, message: '无效的评审批次ID' })
  }

  const data = await forwardAimsRuntimePost<CreateTasksResult>(
    event,
    `/v1/aims/requirement-reviews/${batchId}/create-tasks`,
    { uid }
  )

  return { code: 0, data }
})
