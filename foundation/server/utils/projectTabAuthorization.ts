import { createError, type H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from './platformBundleAuthorization'
import { compileFoundationProjectScope } from './projectScopeAuthorization'
import { enterpriseRuntimePermitExpiresAt } from './enterpriseRuntimeClient'

// projects:edit includes admin through the manifest action policy; view never
// becomes management. Runtime evaluates this projection against live relations.
export async function loadProjectTabAuthorization(event: H3Event, uid: string) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', { resourceCode: 'projects', action: 'edit' })
  if (!Array.isArray(scoped.grants)) throw createError({ statusCode: 503, message: '项目管理范围暂不可用' })
  const scope = compileFoundationProjectScope({ grants: scoped.grants, required: { appCode: 'aims', resourceCode: 'projects', action: 'edit' }, policyOf: () => scoped.actionPolicy }, uid)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (!scope || scoped.uid !== uid || scoped.appCode !== 'aims' || !scoped.bundleVersion || !scoped.bundleHash
    || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw createError({ statusCode: 503, message: '项目管理范围暂不可用' })
  }
  return { resource: 'projects' as const, action: 'edit' as const, scope, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision }
}
