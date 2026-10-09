import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, prepareEnterpriseRuntime, callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { hasTenantGlobalIntegrationOperationGrant } from '@hzy/foundation/server/utils/integrationOperationAdminAuthorization'
import { projectPeopleReadScope, type PeopleDirectoryNode } from '@hzy/foundation/server/utils/peopleScopeProjection'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { peopleFactsOperations, type PeopleFactsOperation, type PeopleFactsInput } from '@hzy/foundation/server/utils/enterprisePeopleFactsPermit'

export function normalizePeopleFacts(operation: PeopleFactsOperation, id: string, raw: Record<string, unknown>): PeopleFactsInput {
  if (!peopleFactsOperations[operation]) throw createError({ statusCode: 400 })
  const list = operation === 'onboarding-list'
  const read = list || operation === 'onboarding-view'
  const create = operation.endsWith('-create') || operation === 'assignments-change'
  const employee = ['display_name', 'initials', 'mobile', 'employment_type', 'onboard_date', 'work_location', 'cost_center_code', 'dept_code']
  const assignment = ['change_type', 'effective_from', 'dept_code', 'position_code', 'rank_code', 'manager_uid', 'remarks']
  const onboarding = ['candidate_name', 'planned_onboard_date', 'dept_code', 'position_code', 'rank_code', 'employment_type', 'canonical_uid', 'corporate_email', 'manager_uid']
  const allowed = read ? list ? ['page', 'pageSize', 'search'] : [] : operation === 'assignments-attach-workflow' ? ['expectedVersion', 'workflowInstanceId', 'employeeUid'] : ['assignments-delete', 'assignments-request-workflow'].includes(operation) ? ['expectedVersion', 'employeeUid', ...(operation === 'assignments-request-workflow' ? ['phase'] : [])] : [...operation.startsWith('employees-') ? employee : operation.startsWith('assignments-') ? assignment : onboarding, ...create ? [] : ['expectedVersion'], ...operation.startsWith('onboarding-') ? [] : ['employeeUid']]
  if (Object.keys(raw).some(k => !allowed.includes(k)) || (list || create ? !!id : !/^[1-9]\d{0,15}$/.test(id))) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = Number(v ?? fallback)
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw createError({ statusCode: 400 })
    return n
  }
  const employeeUid = String(raw.employeeUid || '')
  if (!operation.startsWith('onboarding-') && (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(employeeUid) || /^dt-/i.test(employeeUid))) throw createError({ statusCode: 400 })
  if (Object.hasOwn(raw, 'phase') && raw.phase !== 'recover') throw createError({ statusCode: 400 })
  const payload = read ? {} : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'employeeUid'))
  if (!read && !create) payload.expectedVersion = integer(raw.expectedVersion, 0, 4294967295)
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'expectedVersion') continue
    if (typeof v !== 'string' || v.trim() !== v || [...v].length > 500 || [...v].some(c => [0, 10, 13].includes(c.charCodeAt(0)))) throw createError({ statusCode: 400 })
  }
  return { id, employeeUid, page: list ? integer(raw.page, 1, 1_000_000) : 0, pageSize: list ? integer(raw.pageSize, 20, 100) : 0, search: list ? String(raw.search || '') : '', payload, sensitiveAllowed: false }
}
export async function executePeopleFacts(event: H3Event, operation: PeopleFactsOperation, facts: PeopleFactsInput, key?: string) {
  const user = await requireEnterpriseUser(event)
  const [resource, action] = peopleFactsOperations[operation]
  if ((action === 'edit' || action === 'replay' || (operation.startsWith('offboarding-') && action !== 'view')) && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: resource, action })
  if (scoped.uid !== user.uid || scoped.appCode !== 'people' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  if (operation.startsWith('directory-operations-') && !hasTenantGlobalIntegrationOperationGrant(scoped.grants, { appCode: 'people', action: action as 'view' | 'replay' })) throw createError({ statusCode: 403 })
  const needTree = scoped.grants.some(g => [...g.defaultScopes || [], ...g.assignmentScopes || [], ...g.scopes || []].some(s => s.dimension === 'department'))
  const response = needTree ? await fetchConsoleDirectoryApi<{ code: number, data: { tree: PeopleDirectoryNode[] } }>('/departments', { event }) : null
  const tree = response ? response.data?.tree : []
  if (!Array.isArray(tree)) throw createError({ statusCode: 503 })
  const scope = projectPeopleReadScope({ grants: scoped.grants, required: { appCode: 'people', resourceCode: resource, action }, policyOf: () => scoped.actionPolicy }, user.uid, tree)
  if (!scope) throw createError({ statusCode: 503 })
  if (scope.access === 'none') throw createError({ statusCode: 403 })
  const cost = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: 'standard_costs', action: 'view' })
  if (cost.uid !== user.uid || cost.appCode !== 'people' || cost.bundleVersion !== scoped.bundleVersion || cost.bundleHash !== scoped.bundleHash || cost.policyRevision !== scoped.policyRevision) throw createError({ statusCode: 503 })
  const costScope = projectPeopleReadScope({ grants: cost.grants, required: { appCode: 'people', resourceCode: 'standard_costs', action: 'view' }, policyOf: () => cost.actionPolicy }, user.uid, tree)
  if (!costScope) throw createError({ statusCode: 503 })
  facts.sensitiveAllowed = !operation.startsWith('directory-operations-') && !operation.startsWith('offboarding-') && costScope.access === 'all'
  if (!facts.sensitiveAllowed && ['rank_code', 'cost_center_code'].some(k => Object.hasOwn(facts.payload, k))) throw createError({ statusCode: 403 })
  const op = `people.apf09c1-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0, cost.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action, operation, objectId: `${facts.id}|${facts.employeeUid}`, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope }
  const out = await callEnterpriseRuntime<{ code: number, data: { data: Record<string, unknown>, receiptId?: string } }>(event, op, { peopleFacts: facts, authorization }, { idempotencyKey: key })
  if (out.code !== 0 || !out.data?.data) throw createError({ statusCode: 503 })
  return out
}
export async function enterprisePeopleFacts(event: H3Event, operation: PeopleFactsOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const read = ['onboarding-list', 'onboarding-view'].includes(operation)
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? getQuery(event) : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const facts = normalizePeopleFacts(operation, getRouterParam(event, 'id') || '', raw)
  const result = await executePeopleFacts(event, operation, facts, read ? undefined : getHeader(event, 'idempotency-key'))
  if (read) return result
  // Internal preparation facts and rank snapshots are never exposed by generic
  // browser mutation responses; the orchestrator consumes them on the server.
  const row = result.data.data
  return { code: 0, data: { data: Object.fromEntries(['id', 'row_version', 'assignment_code', 'approval_status', 'status'].filter(k => k in row).map(k => [k, row[k]])), receiptId: result.data.receiptId } }
}
