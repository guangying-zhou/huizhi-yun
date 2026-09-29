import { createError, type H3Event } from 'h3'
import { getConsoleRuntimeConfig } from './consoleRuntime'
import { fetchConsoleServiceJson, requestWithServiceAccessToken, trustedServiceRequestHeaders } from './serviceOidc'
import type { FoundationScopedAuthorizationGrant } from './scopeEvaluator'
import type { ResourceActionPolicy } from '../../shared/utils/authorizationActions'

export interface SubjectScopedAuthorizationResult {
  uid: string
  appCode: string
  purpose: string
  resourceCode: string
  action: string
  authorizationMode: 'merged'
  policyRevision: number | null
  bundleVersion: string
  grants: FoundationScopedAuthorizationGrant[]
  departmentCodes: string[]
  departmentTree: Record<string, string[]>
  actionPolicy?: ResourceActionPolicy
}

// Caller must first authenticate the signed user delegation. Resource/action
// are expectations for validating Console's response, never request overrides.
export async function loadSubjectScopedAuthorizationByService(input: {
  event: H3Event
  subjectUid: string
  purpose: string
  resourceCode: string
  action: string
  timeoutMs?: number
}): Promise<SubjectScopedAuthorizationResult> {
  const runtime = await getConsoleRuntimeConfig({ event: input.event })
  const appCode = String(runtime.app.appCode || '').trim()
  const baseUrl = String(runtime.console.baseUrl || '').replace(/\/+$/, '')
  if (!appCode || !baseUrl || !runtime.tenant?.tenantCode || !runtime.deployment?.deploymentCode) {
    throw createError({ statusCode: 503, message: 'subject_scoped_runtime_binding_unavailable' })
  }
  const response = await requestWithServiceAccessToken<{ code: number, data?: SubjectScopedAuthorizationResult }>({
    event: input.event, audience: 'console', scope: 'console:subject-authorization:read',
    request: token => fetchConsoleServiceJson(input.event, `${baseUrl}/api/v1/console/service/authorization/subject-scoped`, {
      // Fresh-policy authorization may refresh a signed bundle (bounded at
      // 90 seconds in test). Do not cancel it before its own deadline.
      method: 'POST', timeout: input.timeoutMs ?? 10000,
      headers: { ...trustedServiceRequestHeaders(input.event), authorization: `Bearer ${token}` },
      body: { subjectUid: input.subjectUid, purpose: input.purpose }
    })
  }).catch((error: unknown) => {
    const name = (error as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw createError({ statusCode: 503, message: 'subject_scoped_authorization_timeout' })
    }
    throw error
  })
  const data = response?.data
  if (response?.code !== 0 || !data || data.uid !== input.subjectUid || data.appCode !== appCode
    || data.purpose !== input.purpose || data.resourceCode !== input.resourceCode || data.action !== input.action
    || data.authorizationMode !== 'merged' || !Array.isArray(data.grants)
    || !Array.isArray(data.departmentCodes) || data.departmentCodes.some(code => typeof code !== 'string' || !code || code !== code.trim())
    || !data.departmentTree || typeof data.departmentTree !== 'object' || Array.isArray(data.departmentTree)
    || Object.values(data.departmentTree).some(codes => !Array.isArray(codes) || codes.some(code => typeof code !== 'string' || !code || code !== code.trim()))
    || typeof data.bundleVersion !== 'string'
    || !(data.policyRevision === null || (Number.isSafeInteger(data.policyRevision) && Number(data.policyRevision) >= 0))
    || data.grants.some(grant => !grant || !Array.isArray(grant.permissions)
      || grant.permissions.some(permission => permission.appCode !== appCode || permission.resourceCode !== input.resourceCode))) {
    throw createError({ statusCode: 503, message: 'subject_scoped_response_invalid' })
  }
  return data
}
