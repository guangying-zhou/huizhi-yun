/**
 * 恢复已删除规格书章节（功能模块/功能项）
 * POST /api/v1/requirement-contents/:contentId/restore
 *
 * 仅恢复 deprecated 章节；功能项的已删除祖先模块一并恢复，状态置为 modified。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface RestoreResult {
  changed: boolean
  restoredCount: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const contentId = Number(getRouterParam(event, 'contentId'))
  if (!contentId || Number.isNaN(contentId)) {
    throw createError({ statusCode: 400, message: '无效的章节ID' })
  }

  const data = await forwardAimsRuntimePost<RestoreResult>(
    event,
    `/v1/aims/requirement-contents/${contentId}/restore`,
    { uid }
  )

  return { code: 0, data }
})
