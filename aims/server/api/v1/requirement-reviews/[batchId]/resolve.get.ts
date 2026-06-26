/**
 * 解析评审批次所属项目（用于审批中心跳转）
 * GET /api/v1/requirement-reviews/:batchId/resolve
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface RequirementReviewRuntimeRow {
  id: number
  projectId?: number
  project_id?: number
}

function unwrapRuntimeData<T>(value: RuntimeEnvelope<T>): T {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || 'Aims tenant-runtime returned an error.' })
  }
  return value.data as T
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

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RequirementReviewRuntimeRow>>(
    event,
    `/v1/aims/requirement-reviews/${batchId}`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: { current_user: uid }
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for requirement review resolve.'
    })
  }

  const batch = unwrapRuntimeData(runtime.data)
  const projectId = Number(batch.projectId ?? batch.project_id)
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 404, message: '评审批次不存在' })
  }

  return {
    code: 0,
    data: { projectId }
  }
})
