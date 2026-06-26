/**
 * 创建"需求变更"工作项（type=requirement, tier=target）
 * POST /api/v1/projects/:id/requirement-targets
 * Body: { milestoneId: number, title?: string }
 *
 * 变更 target 只能挂在 I/V/R 阶段里程碑下；基线 target 由项目模板自动生成。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface RequirementTargetResult {
  id: number
  itemKey: string
  title: string
  milestoneId: number
  milestoneName: string
  milestonePivrStage: string
  isBaseline: boolean
}

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
  const data = await forwardAimsRuntimePost<RequirementTargetResult>(
    event,
    `/v1/aims/projects/${projectId}/requirement-targets`,
    { uid, query: runtimeQuery, body }
  )

  return { code: 0, data }
})
