import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { setResponseStatus, type H3Event } from 'h3'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { requirePermission } from '~~/server/utils/checkPermission'
import { dispatchServiceTicketDeliveryOperation } from '~~/server/utils/serviceTicketDeliveryOperation'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

function unwrap<T>(response: RuntimeEnvelope<T>, fallback: string) {
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || fallback })
  }
  return response.data as T
}

async function callAimsRuntime<T>(
  event: H3Event,
  path: string,
  method: 'PUT',
  query: Record<string, unknown>,
  body: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: 'aims.write',
    method,
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required to update work items.' })
  }
  return unwrap(runtime.data, 'Aims tenant-runtime returned an error.')
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  const workItemID = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(workItemID) || workItemID <= 0) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }
  await requirePermission(event, 'work_items', 'edit', '需要 AIMS 工作项编辑权限才可以更新工作项')

  const rawBody = await readBody(event)
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {}
  const query = await buildAimsProjectListRuntimeAccessQuery(event, { uid })
  const workItem = await callAimsRuntime<Record<string, unknown>>(
    event,
    `/v1/aims/work-items/${workItemID}`,
    'PUT',
    query,
    body
  )
  const serviceTicketDelivery = workItem.serviceTicketDelivery && typeof workItem.serviceTicketDelivery === 'object'
    ? workItem.serviceTicketDelivery as Record<string, unknown>
    : {}
  const linked = serviceTicketDelivery.linked === true
  const operationKey = String(serviceTicketDelivery.operationKey || '').trim()
  const operationStatus = String(serviceTicketDelivery.operationStatus || '').trim()
  if (linked && operationStatus !== 'succeeded' && !operationKey) {
    throw createError({ statusCode: 502, message: 'Aims service ticket delivery operation metadata is incomplete.' })
  }
  const serviceTicketSync = !linked
    ? { linked: false, synced: false }
    : operationStatus === 'succeeded'
      ? { linked: true, synced: true, pending: false }
      : await dispatchServiceTicketDeliveryOperation(event, operationKey, uid)
  if ('pending' in serviceTicketSync && serviceTicketSync.pending === true) {
    setResponseStatus(event, 202)
  }

  return {
    code: 0,
    data: workItem,
    serviceTicketSync
  }
})
