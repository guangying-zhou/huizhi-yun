/**
 * 提交需求分解结果
 * POST /api/v1/work-items/:id/decompose-submit
 *
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface DecomposeSubmitResult {
  createdWorkItems: Array<{ id: number, itemKey: string, tier: string, type: string, role: 'target' | 'task' }>
  timeEntryId: number
  sourceWorkItemStatus: string
  sourceWorkItemApprovalStatus: string
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

  const body = await readBody<Record<string, unknown>>(event)
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<DecomposeSubmitResult>>(
    event,
    `/v1/aims/work-items/${workItemId}/decompose-submit`,
    {
      appCode: 'aims',
      scope: 'aims.write',
      method: 'POST',
      query: { current_user: uid },
      body: { ...body, current_user: uid }
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for decompose submit.'
    })
  }

  return {
    code: 0,
    data: unwrapRuntimeData(runtime.data)
  }
})
