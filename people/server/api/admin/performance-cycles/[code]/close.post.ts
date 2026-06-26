import { createError, getRouterParam, readBody } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

interface ApiResponse<T> {
  code?: number
  data?: T
  message?: string
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const cycleCode = text(getRouterParam(event, 'code'))
  if (!cycleCode) {
    throw createError({ statusCode: 400, message: 'cycleCode is required' })
  }

  const body = await readBody<RequestBody>(event).catch(() => ({} as RequestBody))
  const activeRoleCode = text(body.activeRoleCode || body.active_role_code)
  const snapshot = await assertPeoplePermission(event, activeRoleCode, 'performance_cycles', 'approve')

  const runtime = await maybeCallTenantRuntime<ApiResponse<Record<string, unknown>>>(
    event,
    `/v1/people/service/performance-cycles/${encodeURIComponent(cycleCode)}:close`,
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      body: {
        ...body,
        operator_uid: snapshot.uid || undefined
      }
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'People performance cycle close failed' })
  }

  return runtime.data
})
