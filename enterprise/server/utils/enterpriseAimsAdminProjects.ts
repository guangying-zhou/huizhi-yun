import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'
import { enterpriseProjectUpdateFields } from './enterpriseAimsProjectUpdate'

const idPattern = /^[1-9]\d*$/
const queryFields = new Set(['page', 'pageSize', 'search', 'category', 'lifecycleStatus', 'portfolioId'])
const categories = new Set(['product_dev', 'custom_dev', 'delivery', 'maintenance', 'sales', 'presales', 'improvement', 'compliance', 'routine'])
const states = new Set(['draft', 'approval_pending', 'active', 'paused', 'completed', 'archived'])

async function requireAdmin(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'admin', 'admin', snapshot.actionPolicies?.admin)) {
    throw createError({ statusCode: 403, message: '缺少 Aims 系统管理权限' })
  }
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'admin', action: 'admin' })
  if (scoped.uid !== user.uid || scoped.appCode !== 'aims' || !Array.isArray(scoped.grants)) throw createError({ statusCode: 503, message: '管理员授权事实不可用' })
  const staticGrants = scoped.grants.filter(grant => [
    ...(grant.scopes || []), ...(grant.defaultScopes || []), ...(grant.assignmentScopes || [])
  ].every(scope => scope.dimension === 'tenant' && scope.predicate === 'global'))
  const decision = evaluateFoundationScopedAuthorization({ grants: staticGrants, required: { appCode: 'aims', resourceCode: 'admin', action: 'admin' }, policyOf: () => scoped.actionPolicy })
  if (!decision.allowed) throw createError({ statusCode: 403, message: '缺少静态 Aims 系统管理权限' })
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt || 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503, message: '管理员授权已过期' })
  return { user, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'admin', action: 'admin', mode: 'admin-static', allowed: true, expiresAt } }
}

export async function enterpriseAimsAdminProjectList(event: H3Event) {
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!queryFields.has(key) || typeof raw !== 'string' || !raw || raw.trim() !== raw) throw createError({ statusCode: 400, message: '管理员项目筛选参数无效' })
    if (key === 'page' && (!idPattern.test(raw) || Number(raw) > 100000)) throw createError({ statusCode: 400, message: '页码无效' })
    if (key === 'pageSize' && (!idPattern.test(raw) || Number(raw) > 100)) throw createError({ statusCode: 400, message: '每页条数无效' })
    if (key === 'search' && [...raw].length > 100) throw createError({ statusCode: 400, message: '搜索词过长' })
    if (key === 'category' && !categories.has(raw)) throw createError({ statusCode: 400, message: '项目分类无效' })
    if (key === 'lifecycleStatus' && !states.has(raw)) throw createError({ statusCode: 400, message: '项目状态无效' })
    if (key === 'portfolioId' && !idPattern.test(raw)) throw createError({ statusCode: 400, message: '项目集标识无效' })
    query[key] = raw
  }
  const { user, authorization } = await requireAdmin(event)
  await prepareEnterpriseRuntime(event, 'aims.admin-project-list')
  return await callEnterpriseRuntime(event, 'aims.admin-project-list', { tenant: user.tenant, deployment: user.deployment, query, authorization })
}

export async function enterpriseAimsAdminProjectUpdate(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '管理员编辑参数无效' })
  const projectId = String(getRouterParam(event, 'id') || '')
  if (!idPattern.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(field => !enterpriseProjectUpdateFields.has(field))) throw createError({ statusCode: 400, message: '管理员编辑字段无效' })
  const { user, authorization } = await requireAdmin(event)
  await prepareEnterpriseRuntime(event, 'aims.admin-project-update')
  const personnel = await enterpriseAimsPersonnel(event, user, input, 'leaderUid', 'projects', projectId, 'edit')
  return await callEnterpriseRuntime(event, 'aims.admin-project-update', { tenant: user.tenant, deployment: user.deployment, projectId, input, personnel, authorization: { ...authorization, projectId } }, { idempotencyKey: key })
}
