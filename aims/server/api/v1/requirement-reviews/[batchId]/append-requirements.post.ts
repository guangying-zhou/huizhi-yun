/**
 * 追加需求到已准备但未提交审批的基线评审批次
 * POST /api/v1/requirement-reviews/:batchId/append-requirements
 * Body: { requirementIds: number[] }
 *
 * 仅限 batch_type='baseline'、status='pending' 且未提交审批的批次；
 * 追加的需求需为草稿态基线需求，且属于同一项目。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface AppendResult {
  batchId: number
  appendedCount: number
  totalCount: number
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
  const data = await forwardAimsRuntimePost<AppendResult>(
    event,
    `/v1/aims/requirement-reviews/${batchId}/append-requirements`,
    { uid, body }
  )

  return { code: 0, data }
})
