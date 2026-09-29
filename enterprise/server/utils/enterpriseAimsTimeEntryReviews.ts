import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, prepareEnterpriseRuntime, callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { timeEntryReviewQuery } from '@hzy/foundation/shared/utils/timeEntryReviewQuery'
import { compileFoundationProjectScope, type FoundationProjectScopeProjection } from '@hzy/foundation/server/utils/projectScopeAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'

export async function enterpriseAimsTimeEntryReviewRead(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const projectId = getRouterParam(event, 'id') || ''
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  let query: Record<string, string>
  try {
    query = timeEntryReviewQuery(getQuery(event))
  } catch {
    throw createError({ statusCode: 400, message: '工时审核周期或分页参数无效' })
  }
  await prepareEnterpriseRuntime(event, 'aims.time-entry-review-list')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const branches: Array<{ action: 'approve' | 'submit', scope: FoundationProjectScopeProjection, bundleVersion: string, bundleHash: string, policyRevision: number, expiresAt: number }> = []
  for (const action of ['approve', 'submit'] as const) {
    if (!authorizationResourcesAllow(snapshot.resources, 'timesheet', action, snapshot.actionPolicies?.timesheet)) continue
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'timesheet', action })
    if (scoped.uid !== user.uid || scoped.appCode !== 'aims' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0 || !Number.isSafeInteger(scoped.authorizationExpiresAt) || scoped.authorizationExpiresAt! <= Date.now()) throw createError({ statusCode: 503, message: '审核授权暂不可用' })
    const input = { grants: scoped.grants, required: { appCode: 'aims', resourceCode: 'timesheet', action }, policyOf: () => scoped.actionPolicy }
    if (!evaluateFoundationScopedAuthorization({ ...input, grants: scoped.grants.map(grant => ({ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] })) }).allowed) continue
    const scope = compileFoundationProjectScope(input, user.uid)
    if (!scope) throw createError({ statusCode: 503, message: '审核授权范围暂不可用' })
    branches.push({ action, scope, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision!, expiresAt: scoped.authorizationExpiresAt! })
  }
  if (!branches.length) throw createError({ statusCode: 403, message: '需要工时审核或被分派的填报职责权限' })
  if (branches.some(branch => branch.bundleVersion !== branches[0]!.bundleVersion || branch.bundleHash !== branches[0]!.bundleHash || branch.policyRevision !== branches[0]!.policyRevision)) throw createError({ statusCode: 503, message: '审核授权在读取期间已变化，请重试' })
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), ...branches.map(branch => branch.expiresAt!))
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'time-entry-reviews', action: 'view', operation: 'list', projectId, query, branches, expiresAt }
  return await callEnterpriseRuntime(event, 'aims.time-entry-review-list', { tenant: user.tenant, deployment: user.deployment, projectId, query, authorization })
}
