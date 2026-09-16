import type { H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  fetchConsoleServiceJson,
  requestServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'

type SingletonRoleCode = 'project_director' | 'qa'

interface RoleHolderResponse {
  code?: number
  data?: {
    roles?: Array<{
      roleCode?: string
      revision?: number
      status?: string
      errorCode?: string | null
      holders?: Array<{ uid?: string, displayName?: string }>
    }>
  }
  message?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function roleHolderEndpoint(event: H3Event) {
  const baseUrl = text(resolveServiceAppBaseUrl(event, 'console', { basePath: '/' }))
  if (!baseUrl) {
    throw createError({
      statusCode: 503,
      message: 'authorization_role_holders_policy_unavailable'
    })
  }
  const base = baseUrl.replace(/\/+$/, '')
  if (base.endsWith('/api/v1')) {
    return `${base}/console/service/authorization/role-holders`
  }
  if (base.endsWith('/api')) {
    return `${base}/v1/console/service/authorization/role-holders`
  }
  return `${base}/api/v1/console/service/authorization/role-holders`
}

export async function resolveProjectGovernanceRoleHolder(
  event: H3Event,
  roleCode: SingletonRoleCode
) {
  const token = await requestServiceAccessToken({
    audience: 'console',
    scope: 'console:authorization-role-holders:read',
    event
  })
  let response: RoleHolderResponse
  try {
    const endpoint = new URL(roleHolderEndpoint(event))
    endpoint.searchParams.set('roleCodes', roleCode)
    response = await fetchConsoleServiceJson<RoleHolderResponse>(event, endpoint, {
      headers: {
        ...trustedServiceRequestHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 5000
    })
  } catch (error: unknown) {
    const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
    if (statusCode === 401 || statusCode === 403) {
      throw createError({ statusCode: 403, message: '项目治理角色持有人校验失败' })
    }
    throw createError({
      statusCode: 503,
      message: 'authorization_role_holders_policy_unavailable'
    })
  }

  const role = response.data?.roles?.find(item => text(item.roleCode) === roleCode)
  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 503,
      message: response.message || 'authorization_role_holders_policy_unavailable'
    })
  }
  if (!role || role.status !== 'resolved' || role.holders?.length !== 1) {
    throw createError({
      statusCode: 409,
      message: role?.errorCode || 'role_holder_unresolved'
    })
  }
  const holder = role.holders[0]
  const uid = text(holder?.uid)
  if (!uid) throw createError({ statusCode: 409, message: 'role_holder_missing' })
  const revision = Number(role.revision || 0)
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw createError({
      statusCode: 503,
      message: 'authorization_role_holder_revision_unavailable'
    })
  }
  return {
    roleCode,
    revision,
    uid,
    displayName: text(holder?.displayName) || uid
  }
}

export async function requireCurrentProjectGovernanceRoleHolder(
  event: H3Event,
  roleCode: SingletonRoleCode,
  expectedUid: string
) {
  const expected = text(expectedUid)
  if (!expected) throw createError({ statusCode: 401, message: '请先登录' })
  const holder = await resolveProjectGovernanceRoleHolder(event, roleCode)
  if (holder.uid !== expected) {
    throw createError({
      statusCode: 403,
      message: `current_${roleCode}_required`
    })
  }
  return holder
}
