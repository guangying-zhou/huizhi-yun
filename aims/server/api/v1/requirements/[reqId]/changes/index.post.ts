/**
 * 创建需求变更草稿
 * POST /api/v1/requirements/:reqId/changes
 * Body: { reason?, contents: Array<{ contentId, title, contentMd }> }
 *
 * 变更需求（item_kind=change）与变更章节版本的业务规则在 tenant-runtime 侧实现。
 * 本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface ChangeDraftResult {
  id: number
  reqCode: string
  parentRequirementId: number
  changeNo: number
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
  const data = await forwardAimsRuntimePost<ChangeDraftResult>(
    event,
    `/v1/aims/requirements/${reqId}/changes`,
    { uid, body }
  )

  return { code: 0, data }
})
