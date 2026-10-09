import { createError, getQuery, getRouterParam, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { projectPeopleReadScope, type PeopleDirectoryNode, type PeopleScopeProjection } from '@hzy/foundation/server/utils/peopleScopeProjection'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

export const peopleOperations = {
  'employees-private-view': ['employees', 'edit'], 'employees-private-update': ['employees', 'edit'],
  'positions-create': ['positions', 'admin'], 'positions-update': ['positions', 'admin'], 'positions-delete': ['positions', 'admin'],
  'ranks-list': ['ranks', 'view'], 'ranks-view': ['ranks', 'view'], 'ranks-create': ['ranks', 'admin'], 'ranks-update': ['ranks', 'admin'], 'ranks-delete': ['ranks', 'admin'],
  'standard-costs-list': ['standard_costs', 'view'], 'standard-costs-view': ['standard_costs', 'view'], 'standard-costs-create': ['standard_costs', 'admin'], 'standard-costs-update': ['standard_costs', 'admin'],
  'employees-search': ['employees', 'view'], 'employees-profile': ['employees', 'view'], 'assignments-list': ['assignments', 'view'], 'assignments-view': ['assignments', 'view']
} as const
export type PeopleOperation = keyof typeof peopleOperations
const none = (): PeopleScopeProjection => ({ access: 'none', departmentCodes: [] })
export function normalizePeopleRequest(operation: PeopleOperation, query: Record<string, unknown>, id: string | undefined, raw: unknown) {
  const list = operation.endsWith('-list') || operation === 'employees-search'
  const write = peopleOperations[operation]?.[1] === 'admin' || operation === 'employees-private-update'
  if (!Object.hasOwn(peopleOperations, operation) || Object.keys(query).some(k => !list || !['page', 'pageSize', 'search'].includes(k)) || Object.values(query).some(v => typeof v !== 'string' && typeof v !== 'number')) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = Number(v ?? fallback)
    if (!/^[1-9]\d*$/.test(String(v ?? fallback)) || !Number.isSafeInteger(n) || n > max) throw createError({ statusCode: 400 })
    return n
  }
  if (id && (operation.startsWith('employees-') ? id.length > 64 || id !== id.trim() || [...id].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) : !/^[1-9]\d*$/.test(id))) throw createError({ statusCode: 400 })
  if (write && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw createError({ statusCode: 400 })
  const payload = write ? raw as Record<string, unknown> : {}
  const position = ['position_code', 'position_name', 'job_family', 'description', 'enabled', 'sort_order']
  const rank = ['rank_code', 'rank_name', 'rank_series', 'rank_level', 'description', 'enabled', 'sort_order']
  const rate = ['rate_code', 'rate_name', 'rank_code', 'rank_series', 'rank_level', 'position_code', 'employment_type', 'cost_center_code', 'rank_salary', 'performance_salary_min', 'performance_salary_max', 'currency', 'effective_from', 'effective_to', 'enabled', 'sort_order', 'remarks']
  const privateFields = ['id_number', 'birth_date', 'education_level', 'major', 'graduation_school', 'graduation_date']
  const fields = operation === 'employees-private-update' ? privateFields : operation.endsWith('-delete') ? [] : operation.startsWith('positions-') ? position : operation.startsWith('ranks-') ? rank : rate
  const allowed = [...fields, ...operation.endsWith('-create') ? [] : ['expectedVersion']]
  if (Object.keys(payload).some(k => !allowed.includes(k)) || Object.values(payload).some(v => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw createError({ statusCode: 400 })
  if (write && !operation.endsWith('-create') && (!Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1)) throw createError({ statusCode: 400 })
  return { id: id || '', page: list ? integer(query.page, 1, 1000000) : 0, pageSize: list ? integer(query.pageSize, 20, 100) : 0, search: String(query.search || ''), payload, costAllowed: false, costScope: none() }
}
export async function enterprisePeople(event: H3Event, operation: PeopleOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const [, action] = peopleOperations[operation]
  const write = action === 'admin' || operation === 'employees-private-update'
  const people = normalizePeopleRequest(operation, getQuery(event), getRouterParam(event, 'id'), write ? await readBody(event) : {})
  const key = write ? getHeader(event, 'idempotency-key') : undefined
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  return executePeopleOperation(event, operation, people, key)
}

async function executePeopleOperation(event: H3Event, operation: PeopleOperation, people: ReturnType<typeof normalizePeopleRequest>, key?: string) {
  const user = await requireEnterpriseUser(event)
  const [resource, action] = peopleOperations[operation]
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: resource, action })
  if (scoped.uid !== user.uid || scoped.appCode !== 'people' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const input = { grants: scoped.grants, required: { appCode: 'people', resourceCode: resource, action }, policyOf: () => scoped.actionPolicy }
  const objectRead = resource === 'employees' || resource === 'assignments'
  let authorizationExpiresAt = scoped.authorizationExpiresAt ?? 0
  let scope: PeopleScopeProjection = { access: 'all', departmentCodes: [] }
  if (operation.startsWith('employees-private-')) {
    const needTree = scoped.grants.some(g => [...g.defaultScopes || [], ...g.assignmentScopes || [], ...g.scopes || []].some(s => s.dimension === 'department'))
    const tree = needTree ? (await fetchConsoleDirectoryApi<{ code: number, data: { tree: PeopleDirectoryNode[] } }>('/departments', { event })).data?.tree : []
    if (!Array.isArray(tree)) throw createError({ statusCode: 503 })
    const projected = projectPeopleReadScope(input, user.uid, tree)
    if (!projected) throw createError({ statusCode: 503 })
    scope = projected
  } else if (objectRead) {
    const cost = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: 'standard_costs', action: 'view' })
    if (cost.uid !== user.uid || cost.appCode !== 'people' || cost.bundleVersion !== scoped.bundleVersion || cost.bundleHash !== scoped.bundleHash || cost.policyRevision !== scoped.policyRevision) throw createError({ statusCode: 503 })
    authorizationExpiresAt = Math.min(authorizationExpiresAt, cost.authorizationExpiresAt ?? 0)
    const needTree = [...scoped.grants, ...cost.grants].some(g => [...g.defaultScopes || [], ...g.assignmentScopes || [], ...g.scopes || []].some(s => s.dimension === 'department'))
    const tree = needTree ? (await fetchConsoleDirectoryApi<{ code: number, data: { tree: PeopleDirectoryNode[] } }>('/departments', { event })).data?.tree : []
    if (!Array.isArray(tree)) throw createError({ statusCode: 503 })
    const projected = projectPeopleReadScope(input, user.uid, tree)
    const costScope = projectPeopleReadScope({ grants: cost.grants, required: { appCode: 'people', resourceCode: 'standard_costs', action: 'view' }, policyOf: () => cost.actionPolicy }, user.uid, tree)
    if (!projected || !costScope) throw createError({ statusCode: 503 })
    scope = projected
    people.costScope = costScope
    people.costAllowed = costScope.access !== 'none'
  } else if (!evaluateFoundationScopedAuthorization(input).allowed) throw createError({ statusCode: 403 })
  if (scope.access === 'none') throw createError({ statusCode: 403 })
  const op = `people.apf09-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), authorizationExpiresAt)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action, operation, objectId: people.id, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope }
  const response = await callEnterpriseRuntime<{ code: number, data: { data: unknown } }>(event, op, { people, authorization }, { idempotencyKey: key })
  if (response.code !== 0 || !response.data || !Object.hasOwn(response.data, 'data')) throw createError({ statusCode: 503 })
  return { code: 0, data: response.data }
}

// Search through the existing scoped Runtime list; never resolve an unscoped ID.
export async function readEnterprisePeopleAssignmentByCode(event: H3Event, code: string) {
  if (!/^ASN-[0-9a-f]{32}$/.test(code)) throw createError({ statusCode: 400, message: '任职编号无效' })
  const result = await executePeopleOperation(event, 'assignments-list', normalizePeopleRequest('assignments-list', { page: 1, pageSize: 100, search: code }, undefined, {}))
  if (!Array.isArray(result.data.data)) throw createError({ statusCode: 503 })
  const matches = result.data.data.filter((row: unknown) => row && typeof row === 'object' && (row as Record<string, unknown>).assignment_code === code) as Record<string, unknown>[]
  if (!matches.length) throw createError({ statusCode: 403, message: '无权查看该任职' })
  if (matches.length !== 1 || !/^[1-9]\d*$/.test(String(matches[0]!.id)) || !Number.isSafeInteger(Number(matches[0]!.id))) throw createError({ statusCode: 503 })
  return matches[0]!
}
