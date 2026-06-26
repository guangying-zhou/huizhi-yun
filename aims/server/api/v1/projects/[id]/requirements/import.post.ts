/**
 * 导入需求规格书
 * POST /api/v1/projects/:id/requirements/import
 * Body: { codocsUuid?, repoProjectCode?, repoFilePath?, docName, mode, headingLevels, items, forceOverwrite? }
 *
 * 业务规则（来源校验、覆盖确认、内容树与需求项落库）在 tenant-runtime 侧实现。
 * 本接口只负责鉴权上下文与转发，并把"需确认覆盖"的 409 还原为前端约定的
 * data.requireConfirm 结构。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface ImportResult {
  contentsCreated: number
  requirementsCreated: number
  requirementIds: number[]
  importStatus: string
}

const REQUIRE_CONFIRM_PATTERN = /存在 (\d+) 条非草稿态需求项/

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const body = (await readBody<Record<string, unknown>>(event).catch(() => ({}))) || {}
  const runtimeQuery = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
  try {
    const data = await forwardAimsRuntimePost<ImportResult>(
      event,
      `/v1/aims/projects/${projectId}/requirements/import`,
      { uid, query: runtimeQuery, body }
    )
    return { code: 0, data }
  } catch (error: unknown) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
    const message = String((error as { message?: string })?.message || '')
    const confirmMatch = statusCode === 409 ? message.match(REQUIRE_CONFIRM_PATTERN) : null
    if (confirmMatch) {
      throw createError({
        statusCode: 409,
        message,
        data: { requireConfirm: true, nonDraftCount: Number(confirmMatch[1]) }
      })
    }
    throw error
  }
})
