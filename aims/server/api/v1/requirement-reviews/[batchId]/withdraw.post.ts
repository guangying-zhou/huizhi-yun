/**
 * 取消评审准备
 * POST /api/v1/requirement-reviews/:batchId/withdraw
 *
 * 把需求项恢复到提交前的状态，并直接删除评审批次。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface WithdrawResult {
  batchId: number
  deleted: boolean
  revertedTo: string
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

  const data = await forwardAimsRuntimePost<WithdrawResult>(
    event,
    `/v1/aims/requirement-reviews/${batchId}/withdraw`,
    { uid }
  )

  return { code: 0, data }
})
