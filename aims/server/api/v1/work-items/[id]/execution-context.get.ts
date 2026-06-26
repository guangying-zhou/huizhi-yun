/**
 * 获取任务执行页上下文
 * GET /api/v1/work-items/:id/execution-context
 *
 * 生产环境的 Aims 数据访问统一走 tenant-runtime/data-runtime。
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ExecutionContextData {
  item: Record<string, unknown>
  deliverables: Array<Record<string, unknown>>
  commits: Array<Record<string, unknown>>
  timeEntries: Array<Record<string, unknown>>
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

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<ExecutionContextData>>(
    event,
    `/v1/aims/work-items/${workItemId}/execution-context`,
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
      message: 'Aims tenant-runtime is required for execution context.'
    })
  }

  return {
    code: 0,
    data: unwrapRuntimeData(runtime.data)
  }
})
