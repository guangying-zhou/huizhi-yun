import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

type Operation = 'aims.project-requirement-list' | 'aims.project-requirement-view'
const numericID = /^[1-9]\d*$/
const allowed = new Set(['page', 'pageSize', 'search', 'type', 'status', 'priority', 'milestone_id', 'source', 'sort', 'order'])
function id(event: H3Event, name: string) { const value = String(getRouterParam(event, name) || '').trim(); if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) throw createError({ statusCode: 400, message: '需求或项目标识无效' }); return value }
function listQuery(event: H3Event) { const result: Record<string, string> = {}; for (const [key, raw] of Object.entries(getQuery(event))) { if (!allowed.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '需求筛选参数无效' }); const value = String(raw ?? '').trim(); if (!value || value.length > 1000) throw createError({ statusCode: 400, message: '需求筛选参数无效' }); result[key] = value }; return result }
async function read(event: H3Event, operation: Operation, projectId: string, query: Record<string, string>, requirementId = '') {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'requirements', 'view', authorization.actionPolicies?.requirements)) throw createError({ statusCode: 403, message: '无项目需求查看权限' })
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, operation, { tenant: user.tenant, deployment: user.deployment, projectId, ...(requirementId ? { requirementId } : {}), query: { ...query, ...scope }, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'requirements', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() } })
}
export const enterpriseAimsProjectRequirementList = (event: H3Event) => read(event, 'aims.project-requirement-list', id(event, 'id'), listQuery(event))
export function enterpriseAimsProjectRequirementView(event: H3Event) { if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '需求详情不接受筛选参数' }); return read(event, 'aims.project-requirement-view', id(event, 'id'), {}, id(event, 'requirementId')) }
