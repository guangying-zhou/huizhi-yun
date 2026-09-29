import { createError, type H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from './platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from './scopeEvaluator'
import { compileFoundationProjectScope } from './projectScopeAuthorization'
import { enterpriseRuntimePermitExpiresAt } from './enterpriseRuntimeClient'

// Compile the action's own grants; never borrow projects:view or its public exception.
export async function loadProjectCommandAuthorization(
  event: H3Event,
  user: { uid: string, tenant: string, deployment: string },
  target: { resource: string, action: 'create' | 'edit' | 'delete' | 'admin' | 'confirm' | 'replay' | 'submit' | 'approve', projectId: string, workItemId: string, projectCode?: string, deptCode?: string }
) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: target.resource, action: target.action })
  if (!Array.isArray(scoped.grants)) throw createError({ statusCode: 503, message: '工作项范围授权暂不可用' })
  const required = { appCode: 'aims', resourceCode: target.resource, action: target.action }
  const allowed = evaluateFoundationScopedAuthorization({ grants: scoped.grants.map(grant => ({ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] })), required, policyOf: () => scoped.actionPolicy }).allowed
  if (!allowed) throw createError({ statusCode: 403, message: '当前用户没有工作项操作权限' })
  const scope = compileFoundationProjectScope({ grants: scoped.grants, required, policyOf: () => scoped.actionPolicy }, user.uid)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (!scope || scoped.uid !== user.uid || scoped.appCode !== 'aims' || !scoped.bundleVersion || !scoped.bundleHash
    || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw createError({ statusCode: 503, message: '工作项范围授权暂不可用' })
  }
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, ...target, allowed, expiresAt,
    scope, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision }
}
