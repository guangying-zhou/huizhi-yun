import { createError, getRouterParam } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { fetchConsoleEmploymentLifecycleStatus } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()

// 依据 Console 报告的下游状态推进入职单终态。
//
// completed 只要求 Platform subject 与 baseline 权限成功；岗位角色没有匹配时
// Platform 侧仍返回成功并生成管理员待办，不阻塞入职完成。
export default defineEventHandler(async (event) => {
  const snapshot = await assertPeoplePermission(event, 'employees', 'view')
  const actorUid = text(snapshot.uid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const scopeQuery = await requirePeopleGlobalEmployeeScope(event, actorUid)

  const code = text(getRouterParam(event, 'code'))
  if (!code) throw createError({ statusCode: 400, message: '缺少入职单编码。' })

  const runtime = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    `/v1/people/onboarding-cases/${encodeURIComponent(code)}`,
    { appCode, scope: 'people.read', method: 'GET', query: { ...scopeQuery, current_user: actorUid } }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  const record = ((runtime.data as ApiResponse<Row>)?.data || {}) as Row
  const uid = text(record.canonical_uid)
  if (!uid) throw createError({ statusCode: 409, message: '该入职单尚未预留 canonical UID。' })

  const status = await fetchConsoleEmploymentLifecycleStatus(event, uid)

  const aggregated = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    `/v1/people/onboarding-cases/${encodeURIComponent(code)}:aggregate-status`,
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      query: { ...scopeQuery, current_user: actorUid, operator_uid: actorUid },
      body: {
        directory_applied: Boolean((status as Row)?.directoryApplied),
        platform_status: text((status as Row)?.platformStatus),
        operator_uid: actorUid
      }
    }
  )
  if (!aggregated.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  return (aggregated.data as ApiResponse<Row>) || { code: 0, data: {} }
})
