import { createError, type H3Event } from 'h3'
import {
  fetchConsoleServiceJson,
  requestServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'

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

function endpoint(event: H3Event) {
  const baseUrl = text(resolveServiceAppBaseUrl(event, 'console', { basePath: '/' })).replace(/\/+$/, '')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'authorization_role_holders_policy_unavailable' })
  const path = baseUrl.endsWith('/api/v1')
    ? `${baseUrl}/console/service/authorization/role-holders`
    : baseUrl.endsWith('/api')
      ? `${baseUrl}/v1/console/service/authorization/role-holders`
      : `${baseUrl}/api/v1/console/service/authorization/role-holders`
  const url = new URL(path)
  url.searchParams.set('roleCodes', 'project_director')
  return url
}

export async function resolveWorkflowProjectDirectorRoleHolder(event: H3Event) {
  const token = await requestServiceAccessToken({
    audience: 'console',
    scope: 'console:authorization-role-holders:read',
    event
  })
  let response: RoleHolderResponse
  try {
    response = await fetchConsoleServiceJson<RoleHolderResponse>(event, endpoint(event), {
      method: 'GET',
      headers: {
        ...trustedServiceRequestHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 5000
    })
  } catch {
    throw createError({ statusCode: 503, message: 'authorization_role_holders_policy_unavailable' })
  }
  return projectDirectorFromResponse(response)
}

export function projectDirectorFromResponse(response: RoleHolderResponse) {
  const role = response.data?.roles?.find(item => text(item.roleCode) === 'project_director')
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 503, message: response.message || 'authorization_role_holders_policy_unavailable' })
  }
  if ((role?.holders?.length || 0) > 1 || role?.status === 'ambiguous') {
    throw createError({ statusCode: 409, message: 'role_holder_ambiguous' })
  }
  if (!role || role.status !== 'resolved' || role.holders?.length !== 1) {
    console.warn('[WorkflowRoleHolder] Project director role holder is unresolved', {
      status: role?.status || 'missing_response',
      errorCode: role?.errorCode || 'role_holder_unresolved',
      holderCount: role?.holders?.length || 0
    })
    throw createError({ statusCode: 409, message: role?.errorCode || 'role_holder_unresolved' })
  }
  const uid = text(role.holders[0]?.uid)
  const revision = Number(role.revision || 0)
  if (!uid || !Number.isSafeInteger(revision) || revision <= 0) {
    throw createError({ statusCode: 503, message: 'authorization_role_holder_revision_unavailable' })
  }
  return {
    uid,
    revision,
    displayName: text(role.holders[0]?.displayName) || uid
  }
}

// Only missing/unresolved role facts degrade. Conflicts and dependency errors
// retain their original status. Runtime decides whether a write needs this role.
export async function workflowProjectDirectorFacts(event: H3Event) {
  try {
    return await resolveWorkflowProjectDirectorRoleHolder(event)
  } catch (error) {
    const failure = error as { statusCode?: number, message?: string }
    if (failure.statusCode === 409
      && ['role_holder_missing', 'role_holder_unresolved'].includes(failure.message || '')) {
      return null
    }
    throw error
  }
}
