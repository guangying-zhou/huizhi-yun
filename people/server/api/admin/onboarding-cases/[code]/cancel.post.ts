import { createError, getRouterParam, readBody } from 'h3'
import { extractServiceOperationCode } from '@hzy/foundation/server/utils/serviceOperation'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callConsoleOnboardingProvisioning } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>
const text = (value: unknown) => String(value || '').trim()

export default defineEventHandler(async (event) => {
  const snapshot = await assertPeoplePermission(event, 'employees', 'admin')
  const actorUid = text(snapshot.uid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const scopeQuery = await requirePeopleGlobalEmployeeScope(event, actorUid)
  const code = text(getRouterParam(event, 'code'))
  const body = await readBody<Row>(event).catch(() => ({} as Row))
  const reason = text(body.reason)
  if (!code) throw createError({ statusCode: 400, message: '缺少入职单编码。' })
  if ([...reason].length < 5) throw createError({ statusCode: 400, message: '取消原因至少需要 5 个字符。' })

  const current = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    `/v1/people/onboarding-cases/${encodeURIComponent(code)}`,
    { appCode, scope: 'people.read', method: 'GET', query: { ...scopeQuery, current_user: actorUid } }
  )
  if (!current.handled) throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  const record = ((current.data as ApiResponse<Row>)?.data || {}) as Row
  if (!text(record.onboarding_code)) throw createError({ statusCode: 404, message: '入职单不存在。' })

  if (text(record.status) !== 'cancelled') {
    const cancelled = await maybeCallTenantRuntime<ApiResponse<Row>>(
      event,
      `/v1/people/onboarding-cases/${encodeURIComponent(code)}:cancel`,
      {
        appCode,
        scope: 'people.write',
        method: 'POST',
        query: { ...scopeQuery, current_user: actorUid, operator_uid: actorUid },
        body: {
          reason,
          object_version: Number(body.objectVersion ?? body.object_version ?? record.object_version),
          operator_uid: actorUid
        }
      }
    )
    if (!cancelled.handled) throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }

  const reservationId = text(record.reservation_id)
  if (reservationId) {
    try {
      await callConsoleOnboardingProvisioning(event, {
        kind: 'identity-release',
        onboardingCode: code,
        objectVersion: Number(record.object_version),
        uid: text(record.canonical_uid),
        actorUid,
        command: { reservationId }
      })
    } catch (error) {
      console.error('[People Onboarding] cancelled reservation release failed', {
        onboardingCode: code,
        errorCode: extractServiceOperationCode(error)
      })
      throw createError({ statusCode: 502, message: '入职单已取消，但身份预留释放失败，请重试取消操作。' })
    }
  }
  return { code: 0, data: { onboardingCode: code, status: 'cancelled' } }
})
