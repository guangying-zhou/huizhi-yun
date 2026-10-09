import { createError, getRouterParam, readBody } from 'h3'
import { extractServiceOperationCode, extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callConsoleOnboardingProvisioning } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()

function unwrapRuntimeRow(value: unknown) {
  return (((value as ApiResponse<Row> | undefined)?.data || {}) as Row)
}

function failureState(error: unknown) {
  const status = extractServiceOperationStatus(error)
  const code = extractServiceOperationCode(error, status)
  if (code.startsWith('onboarding_')) return { status: 'provisioning_failed', code, definite: false }
  if (code.includes('in_progress') || code.includes('pending')) {
    return { status: 'provisioning_failed', code, definite: false }
  }
  if (status === 401 || status === 403) return { status: 'provisioning_failed', code, definite: true }
  if (status === undefined || status >= 500 || [408, 425, 429].includes(status)) {
    return { status: 'provisioning_failed', code, definite: false }
  }
  if (code === 'directory_reservation_expired' || code === 'directory_reservation_missing') {
    return { status: 'reservation_expired', code, definite: true }
  }
  if (code.includes('identity') || code.includes('uid_taken') || code.includes('username_taken') || code.includes('email_taken')) {
    return { status: 'identity_conflict', code, definite: true }
  }
  if (status === 400 || status === 409 || status === 422) {
    return { status: 'profile_conflict', code, definite: true }
  }
  return { status: 'provisioning_failed', code, definite: true }
}

// 入职单开通编排是可恢复的三段式：进入预留态、持久化预留回执、排队建号。
// 每段都以 People 的 object_version 冻结下一条命令；断线重试会从已落库的阶段
// 继续，不会重新预留身份或创建第二个 LDAP 账号。
export default defineEventHandler(async (event) => {
  const snapshot = await assertPeoplePermission(event, 'employees', 'admin')
  const actorUid = text(snapshot.uid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const scopeQuery = await requirePeopleGlobalEmployeeScope(event, actorUid)

  const code = text(getRouterParam(event, 'code'))
  if (!code) throw createError({ statusCode: 400, message: '缺少入职单编码。' })
  const body = await readBody<Row>(event).catch(() => ({} as Row))

  const runtime = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    `/v1/people/onboarding-cases/${encodeURIComponent(code)}`,
    { appCode, scope: 'people.read', method: 'GET', query: { ...scopeQuery, current_user: actorUid } }
  )
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  const record = unwrapRuntimeRow(runtime.data)
  if (!text(record.onboarding_code)) throw createError({ statusCode: 404, message: '入职单不存在。' })

  const initialStatus = text(record.status)
  const resumable = ['ready_for_provisioning', 'reserving_identity', 'reservation_expired', 'provisioning_failed']
  if (!resumable.includes(initialStatus)) {
    throw createError({ statusCode: 409, message: '入职单当前状态不能开通或继续开通。' })
  }
  const requestedVersion = Number(body.objectVersion ?? body.object_version ?? record.object_version)
  if (!(requestedVersion > 0) || requestedVersion !== Number(record.object_version)) {
    throw createError({ statusCode: 409, message: '入职单已被他人修改，请刷新后重试。' })
  }

  let currentVersion = requestedVersion
  let reservationId = text(record.reservation_id)

  const callPeopleTransition = async (action: string, transitionBody: Row) => {
    const result = await maybeCallTenantRuntime<ApiResponse<Row>>(
      event,
      `/v1/people/onboarding-cases/${encodeURIComponent(code)}:${action}`,
      {
        appCode,
        scope: 'people.write',
        method: 'POST',
        query: { ...scopeQuery, current_user: actorUid, operator_uid: actorUid },
        body: { ...transitionBody, operator_uid: actorUid }
      }
    )
    if (!result.handled) throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
    return unwrapRuntimeRow(result.data)
  }

  if (initialStatus !== 'reserving_identity') {
    const begun = await callPeopleTransition('begin-provisioning', { object_version: currentVersion })
    currentVersion = Number(begun.objectVersion || currentVersion + 1)
    reservationId = ''
  }

  const shared = () => ({
    onboardingCode: code,
    objectVersion: currentVersion,
    uid: text(record.canonical_uid),
    actorUid
  })

  try {
    if (!reservationId) {
      const reservation = await callConsoleOnboardingProvisioning(event, {
        ...shared(),
        kind: 'identity-reserve',
        command: {
          username: text(record.canonical_uid),
          email: text(record.corporate_email),
          providerCode: text(record.provider_code),
          providerSubject: text(record.provider_subject)
        }
      }) as Row
      reservationId = text(reservation.reservationId)
      if (!reservationId) throw createError({ statusCode: 502, message: 'Console 未返回身份预留回执。' })
      const saved = await callPeopleTransition('reserved', {
        reservation_id: reservationId,
        object_version: currentVersion
      })
      currentVersion = Number(saved.objectVersion || currentVersion + 1)
    }

    const provision = await callConsoleOnboardingProvisioning(event, {
      ...shared(),
      kind: 'user-provision',
      command: {
        reservationId,
        username: text(record.canonical_uid),
        displayName: text(record.candidate_name),
        email: text(record.corporate_email),
        mobile: text(record.mobile),
        positionName: text(record.position_code),
        deptCode: text(record.dept_code),
        providerCode: text(record.provider_code),
        providerSubject: text(record.provider_subject)
      }
    }) as Row
    const operationId = text(provision.operationId)
    if (!operationId) throw createError({ statusCode: 502, message: 'Console 未返回账号开通操作编号。' })

    const marked = await callPeopleTransition('provisioning', {
      reservation_id: reservationId,
      provision_operation_id: operationId,
      object_version: currentVersion
    })
    return {
      code: 0,
      data: {
        onboardingCode: code,
        status: text(marked.status) || 'provisioning_account',
        reservationId,
        operationId,
        activationDelivered: false
      }
    }
  } catch (error) {
    const failure = failureState(error)
    // 超时、断网和 5xx 的执行结果不确定，保留当前阶段供同一幂等命令续跑。
    if (!failure.definite) throw error

    if (reservationId) {
      try {
        await callConsoleOnboardingProvisioning(event, {
          ...shared(),
          kind: 'identity-release',
          command: { reservationId }
        })
      } catch (releaseError) {
        // 释放结果不确定时保留 reserving_identity + reservation_id；下一次继续
        // 开通会先重试同一条释放/预留链路。先清 People 引用会让补偿失去目标，
        // 只能被动等 24 小时 TTL。
        console.error('[People Onboarding] reservation release failed', {
          onboardingCode: code,
          errorCode: extractServiceOperationCode(releaseError)
        })
        throw releaseError
      }
    }
    await callPeopleTransition('failure', {
      status: failure.status,
      error_code: failure.code,
      object_version: currentVersion
    }).catch(markError => console.error('[People Onboarding] failure state update failed', {
      onboardingCode: code,
      errorCode: extractServiceOperationCode(markError)
    }))
    throw error
  }
})
