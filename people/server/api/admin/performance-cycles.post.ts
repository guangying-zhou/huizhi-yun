import { createError, readBody } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

interface ApiResponse<T> {
  code?: number
  data?: T
  message?: string
}

type RequestBody = Record<string, unknown>

const cycleTypes = new Set(['month', 'quarter', 'project', 'annual'])
const scopeTypes = new Set(['org', 'team', 'project'])

function text(value: unknown) {
  return String(value || '').trim()
}

function requireText(body: RequestBody, keys: string[], field: string) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  throw createError({ statusCode: 400, message: `${field} is required` })
}

function dateValue(body: RequestBody, keys: string[], field: string) {
  const value = requireText(body, keys, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: `${field} must be YYYY-MM-DD` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RequestBody>(event).catch(() => ({} as RequestBody))
  const activeRoleCode = text(body.activeRoleCode || body.active_role_code)
  const snapshot = await assertPeoplePermission(event, activeRoleCode, 'performance_cycles', 'edit')

  const cycleName = requireText(body, ['cycleName', 'cycle_name'], 'cycleName')
  const cycleType = text(body.cycleType || body.cycle_type) || 'quarter'
  const scopeType = text(body.scopeType || body.scope_type) || 'project'
  const periodStart = dateValue(body, ['periodStart', 'period_start'], 'periodStart')
  const periodEnd = dateValue(body, ['periodEnd', 'period_end'], 'periodEnd')
  const cycleCode = text(body.cycleCode || body.cycle_code)
  const projectCode = text(body.projectCode || body.project_code)

  if (!cycleTypes.has(cycleType)) {
    throw createError({ statusCode: 400, message: 'cycleType is invalid' })
  }
  if (!scopeTypes.has(scopeType)) {
    throw createError({ statusCode: 400, message: 'scopeType is invalid' })
  }
  if (periodStart > periodEnd) {
    throw createError({ statusCode: 400, message: 'periodStart must be earlier than or equal to periodEnd' })
  }
  if (scopeType === 'project' && !projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode is required for project-scoped cycle' })
  }

  const payload: Record<string, unknown> = {
    cycle_name: cycleName,
    cycle_type: cycleType,
    scope_type: scopeType,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'draft',
    created_by: snapshot.uid || undefined,
    updated_by: snapshot.uid || undefined
  }
  if (cycleCode) payload.cycle_code = cycleCode
  if (projectCode) payload.project_code = projectCode

  const runtime = await maybeCallTenantRuntime<ApiResponse<Record<string, unknown>>>(
    event,
    '/v1/people/performance-cycles',
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      body: payload
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'People performance cycle create failed' })
  }

  return runtime.data
})
