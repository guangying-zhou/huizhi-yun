import { createError, getQuery, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { callEnterpriseNotificationRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { prepareTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { buildAltocDepartmentTreeCodeIndex, hasAltocGlobalAdminRole, resolveAltocDataAccessQueryFromScopedGrants, scopedGrantsNeedAltocDepartmentTree, type AltocDepartmentScopeTreeNode } from '../../../altoc/server/utils/altocDataAccessScope'

export type APFDomain = 'altoc' | 'finance' | 'people'
type APFOperation = 'list' | 'view' | 'save'
const domainSpec = {
  altoc: { resource: 'customer', write: 'edit', stem: 'altoc.apf-customer' },
  finance: { resource: 'bank_accounts', write: 'admin', stem: 'finance.bank-account' },
  people: { resource: 'positions', write: '', stem: 'people.position' }
} as const

export function normalizeAPFInput(domain: APFDomain, operation: APFOperation, raw: Record<string, unknown>) {
  if (!(Object.hasOwn(domainSpec, domain)) || (domain === 'people' && operation === 'save')) throw createError({ statusCode: 403 })
  const allowed = operation === 'list' ? ['page', 'pageSize', 'search'] : operation === 'view' ? ['id'] : ['id', 'code', 'name', domain === 'finance' ? 'expectedVersion' : 'rowVersion']
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw createError({ statusCode: 400 })
  if (Object.values(raw).some(value => value !== undefined && typeof value !== 'string' && typeof value !== 'number')) throw createError({ statusCode: 400 })
  const integer = (key: string, fallback: number, max: number) => {
    const value = raw[key] ?? fallback
    if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw createError({ statusCode: 400 })
    return Number(value)
  }
  const input = { id: String(raw.id || ''), code: String(raw.code || ''), name: String(raw.name || ''), rowVersion: integer(domain === 'finance' ? 'expectedVersion' : 'rowVersion', 0, 4_294_967_295), page: operation === 'list' ? integer('page', 1, 1_000_000) : 0, pageSize: operation === 'list' ? integer('pageSize', 20, 100) : 0, search: String(raw.search || '') }
  const invalidId = Boolean(input.id) && (!/^[1-9]\d{0,15}$/.test(input.id) || !Number.isSafeInteger(Number(input.id)))
  const invalidList = operation === 'list' && (!input.page || !input.pageSize || new TextEncoder().encode(input.search).length > 200)
  const invalidSave = operation === 'save' && (!/^[A-Za-z0-9_-]{1,50}$/.test(input.code) || !input.name || input.name.trim() !== input.name || [...input.name].length > 200 || (input.id ? input.rowVersion < 1 : input.rowVersion !== 0))
  const hasControl = [...input.search + input.name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  if (invalidId || (operation === 'view' && !input.id) || invalidList || invalidSave || hasControl) throw createError({ statusCode: 400 })
  return input
}
export async function buildAPFPermit(event: H3Event, domain: APFDomain, operation: APFOperation, input: ReturnType<typeof normalizeAPFInput>, user: { uid: string, tenant: string, deployment: string }, resourceOverride?: 'receivable' | 'quotation' | 'contract' | 'lead' | 'opportunity' | 'service_ticket' | 'renewal_opportunity', actionOverride?: 'set-due-date' | 'followup' | 'edit' | 'assign' | 'disqualify' | 'convert' | 'activity' | 'transition' | 'close' | 'reopen') {
  const spec = { ...domainSpec[domain], resource: resourceOverride || domainSpec[domain].resource }
  const action = actionOverride || (operation === 'save' ? spec.write : 'view')
  const originalScoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, domain, { resourceCode: spec.resource, action })
  // New collection writes require an exact granted action, even if an older
  // signed policy carried a broad admin implication. Retain only those grants
  // when compiling the write scope; an implied grant cannot widen that scope.
  const exactCollectionWrite = domain === 'altoc' && spec.resource === 'receivable' && ['assign', 'set-due-date', 'followup'].includes(action)
  const scoped = exactCollectionWrite ? { ...originalScoped, grants: originalScoped.grants.map(grant => ({ ...grant, permissions: grant.permissions.filter(permission => permission.appCode === domain && permission.resourceCode === spec.resource && permission.action === action) })).filter(grant => grant.permissions.length) } : originalScoped
  if (scoped.uid !== user.uid || scoped.appCode !== domain || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0) throw createError({ statusCode: 503 })
  let scope: { access: string, departmentCodes: string[] } = { access: 'all', departmentCodes: [] }
  const inputPolicy = { grants: scoped.grants, required: { appCode: domain, resourceCode: spec.resource, action }, policyOf: () => scoped.actionPolicy }
  if (domain === 'altoc') {
    const admin = hasAltocGlobalAdminRole(scoped.roles)
    if ((actionOverride || !admin) && !evaluateFoundationScopedAuthorization({ ...inputPolicy, grants: scoped.grants.map(grant => ({ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] })) }).allowed) throw createError({ statusCode: 403 })
    const currentDeptCodes: string[] = []
    const needsDepartments = !admin && scoped.grants.some(grant => [...(grant.scopes || []), ...(grant.defaultScopes || []), ...(grant.assignmentScopes || [])].some(s => s.dimension === 'department' && s.predicate === 'self' && !s.value))
    if (needsDepartments) {
      const response = await fetchConsoleDirectoryApi<{ code: number, data?: { departments?: { deptCode: string }[], primaryDeptCode?: string } }>('/user-departments', { event, params: { uid: user.uid } })
      if (response.code !== 0 || !Array.isArray(response.data?.departments)) throw createError({ statusCode: 503 })
      currentDeptCodes.push(...response.data.departments.map(d => d.deptCode), ...(response.data.primaryDeptCode ? [response.data.primaryDeptCode] : []))
    }
    let departmentTreeCodesByRoot
    if (!admin && scopedGrantsNeedAltocDepartmentTree(scoped.grants)) {
      const response = await fetchConsoleDirectoryApi<{ code: number, data?: { tree?: AltocDepartmentScopeTreeNode[] } }>('/departments', { event })
      if (response.code !== 0 || !Array.isArray(response.data?.tree)) throw createError({ statusCode: 503 })
      departmentTreeCodesByRoot = buildAltocDepartmentTreeCodeIndex(response.data.tree)
    }
    const compiled = resolveAltocDataAccessQueryFromScopedGrants({ appCode: domain, grants: scoped.grants, currentDeptCodes, resource: spec.resource, action: action as 'view' | 'edit', actionPolicy: scoped.actionPolicy, hasGlobalAdminRole: admin, departmentTreeCodesByRoot })
    scope = { access: String(compiled.current_user_altoc_access || 'none'), departmentCodes: String(compiled.current_user_altoc_dept_codes || '').split(',').filter(Boolean) }
    if (scope.access === 'none') throw createError({ statusCode: 403 })
  } else {
    // Bank metadata and the position dictionary retain their existing static
    // resource/action gates. Object-constrained grants are not flattened to all:
    // the unique Foundation evaluator must authorize without object facts.
    if (!evaluateFoundationScopedAuthorization(inputPolicy).allowed) throw createError({ statusCode: 403 })
  }
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: spec.resource, action, operation, objectId: input.id, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope }
}

export async function enterpriseAPFUser(event: H3Event, domain: APFDomain, operation: APFOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  if (operation === 'save' && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = operation === 'save' ? await readBody<Record<string, unknown>>(event) : getQuery(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const input = normalizeAPFInput(domain, operation, raw)
  const key = operation === 'save' ? getHeader(event, 'idempotency-key') : undefined
  if (operation === 'save' && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: 'Idempotency-Key is required.' })
  const op = `${domainSpec[domain].stem}-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = await buildAPFPermit(event, domain, operation, input, user)
  return await callEnterpriseRuntime(event, op, { ...input, authorization }, { idempotencyKey: key })
}

export async function enterpriseAPFNotification(event: H3Event, body: Record<string, unknown>) {
  const domain = body.sourceAppCode as APFDomain
  if (!(Object.hasOwn(domainSpec, domain))) throw createError({ statusCode: 403 })
  const request = parseNotificationDetailAuthorizationRequest(body)
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'enterprise:notification-detail:authorize' })
  if (Object.keys(request.descriptor).some(key => !['resource', 'id'].includes(key)) || request.descriptor.resource !== domainSpec[domain].resource) throw createError({ statusCode: 400 })
  const input = normalizeAPFInput(domain, 'view', { id: request.descriptor.id })
  const host = resolveTrustedTenantGatewayContext(event)
  if (!host || host.appCode !== 'enterprise' || host.tenant !== caller.tenantId) throw createError({ statusCode: 403 })
  if (!await prepareTenantRuntime(event, { appCode: 'enterprise', scope: `${domain}:notification-detail:authorize`, capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy' })) throw createError({ statusCode: 503 })
  const authorization = await buildAPFPermit(event, domain, 'view', input, { uid: caller.subjectUid, tenant: caller.tenantId, deployment: host.deployment })
  const result = await callEnterpriseNotificationRuntime<{ code: number, data: { allowed: boolean } }>(event, domain, { uid: caller.subjectUid, tenantId: caller.tenantId, deploymentId: caller.deploymentId }, { ...input, authorization })
  if (result.code !== 0 || typeof result.data?.allowed !== 'boolean') throw createError({ statusCode: 503 })
  return { code: 0, data: { allowed: result.data.allowed, descriptor: request.descriptor } }
}
