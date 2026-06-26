/**
 * 评审通过回调
 * POST /api/v1/requirement-reviews/:batchId/approve
 * Body: { approvedBy?, workflowInstanceId?, changeReason?, changeCode? }
 *
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface ApproveResult {
  batchId: number
  approved: boolean
  requirementsUpdated: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const batchId = Number(getRouterParam(event, 'batchId'))
  if (!batchId || Number.isNaN(batchId)) {
    throw createError({ statusCode: 400, message: '无效的批次ID' })
  }

  const body = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) || {}
  const data = await forwardAimsRuntimePost<ApproveResult>(
    event,
    `/v1/aims/requirement-reviews/${batchId}/approve`,
    { uid, body }
  )

  return { code: 0, data }
})
