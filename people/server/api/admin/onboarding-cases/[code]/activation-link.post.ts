import { createError, getRouterParam } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callConsoleOnboardingProvisioning, fetchConsoleProvisionOperationStatus } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>
const text = (value: unknown) => String(value || '').trim()

// 显式重发激活链接。每次成功调用都会让旧令牌失效，因此只能由 HR 主动触发，
// 不和轮询、页面刷新等读操作绑定。
export default defineEventHandler(async (event) => {
  const snapshot = await assertPeoplePermission(event, 'employees', 'admin')
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
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  const record = ((runtime.data as ApiResponse<Row>)?.data || {}) as Row
  if (!['provisioning_account', 'activating_employee', 'projecting_authorization', 'authorization_failed', 'completed'].includes(text(record.status))) {
    throw createError({ statusCode: 409, message: '目录账号尚未创建，不能发送激活链接。' })
  }
  const operationId = text(record.provision_operation_id)
  const common = {
    operationId,
    onboardingCode: code,
    objectVersion: Number(record.object_version),
    uid: text(record.canonical_uid),
    actorUid
  }
  const operation = await fetchConsoleProvisionOperationStatus(event, common)
  if (text((operation as Row).status) !== 'succeeded') {
    throw createError({ statusCode: 409, message: '目录账号尚未创建成功，暂不能发送激活链接。' })
  }

  const activation = await callConsoleOnboardingProvisioning(event, {
    kind: 'activation-link',
    onboardingCode: code,
    objectVersion: Number(record.object_version),
    uid: text(record.canonical_uid),
    actorUid,
    command: {
      provisionOperationId: operationId,
      providerCode: text(record.provider_code),
      providerSubject: text(record.provider_subject)
    }
  }) as Row
  if (!activation.activationDelivered) {
    throw createError({ statusCode: 502, message: '激活链接投递失败，请检查钉钉通知配置后重试。' })
  }
  return { code: 0, data: activation }
})
