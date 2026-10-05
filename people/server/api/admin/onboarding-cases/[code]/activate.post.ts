import { createError, getRouterParam } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callConsoleOnboardingProvisioning, fetchConsoleProvisionOperationStatus } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()

// 把已开通的入职单激活为正式员工。
//
// 激活前必须向 Console 验真建号回执：设计明确禁止相信浏览器声称「账号已创建」。
// 员工创建、首次任职和生命周期冻结在 runtime 的同一事务内完成，后续 Console
// 目录与 Platform 授权交给现有可靠链路。
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
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  const record = ((runtime.data as ApiResponse<Row>)?.data || {}) as Row
  const operationId = text(record.provision_operation_id)
  if (!operationId) {
    throw createError({ statusCode: 409, message: '该入职单尚未发起账号开通。' })
  }

  const status = await fetchConsoleProvisionOperationStatus(event, {
    operationId,
    onboardingCode: code,
    objectVersion: Number(record.object_version),
    uid: text(record.canonical_uid),
    actorUid
  })
  const operationStatus = text((status as Row)?.status)
  if (operationStatus !== 'succeeded') {
    const failed = ['dead_letter', 'failed', 'cancelled'].includes(operationStatus)
    if (failed) {
      await maybeCallTenantRuntime<ApiResponse<Row>>(
        event,
        `/v1/people/onboarding-cases/${encodeURIComponent(code)}:failure`,
        {
          appCode,
          scope: 'people.write',
          method: 'POST',
          query: { ...scopeQuery, current_user: actorUid, operator_uid: actorUid },
          body: {
            status: 'provisioning_failed',
            error_code: text((status as Row)?.errorCode) || `directory_operation_${operationStatus}`,
            object_version: Number(record.object_version),
            operator_uid: actorUid
          }
        }
      )
    }
    throw createError({
      statusCode: 409,
      message: failed
        ? `账号创建失败（${text((status as Row)?.errorCode) || operationStatus}），请修正资料后重新开通。`
        : '账号仍在创建中，请稍后再激活。'
    })
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
    throw createError({ statusCode: 502, message: '账号已创建，但激活链接投递失败；请确认钉钉通知配置后重试。' })
  }

  const activated = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    `/v1/people/onboarding-cases/${encodeURIComponent(code)}:activate`,
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      query: { ...scopeQuery, current_user: actorUid, operator_uid: actorUid },
      body: { verified_operation_id: operationId, operator_uid: actorUid }
    }
  )
  if (!activated.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  return (activated.data as ApiResponse<Row>) || { code: 0, data: {} }
})
