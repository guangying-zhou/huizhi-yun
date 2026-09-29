import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { buildAltocDepartmentTreeCodeIndex, hasAltocGlobalAdminRole, resolveAltocDataAccessQueryFromScopedGrants, scopedGrantsNeedAltocDepartmentTree, type AltocDepartmentScopeTreeNode } from '../../../altoc/server/utils/altocDataAccessScope'
import { altocReadFields, altocContractChildFields, altocQuotationItemFields, type AltocReadResource } from '../../shared/altoc-basic-read'

const idPattern = /^[1-9]\d{0,15}$/
function validId(id: string) { return idPattern.test(id) && Number.isSafeInteger(Number(id)) }
function readInput(event: H3Event, resource: AltocReadResource, detail: boolean) {
  const raw = getQuery(event)
  if (detail && Object.keys(raw).length) throw createError({ statusCode: 400 })
  const allowed = ['page', 'pageSize', 'search', 'status', ...(!['customer', 'lead'].includes(resource) ? ['customerId'] : []), ...(resource === 'receivable' ? ['contractId'] : []), ...(resource === 'quotation' ? ['opportunityId'] : [])]
  for (const [key, value] of Object.entries(raw)) if (!allowed.includes(key) || typeof value !== 'string' || !value.trim()) throw createError({ statusCode: 400 })
  const integer = (key: string, fallback: number, max: number) => {
    const value = raw[key]
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw createError({ statusCode: 400 })
    return Number(value)
  }
  const string = (key: string, max: number) => {
    const value = String(raw[key] || '').trim()
    if (new TextEncoder().encode(value).length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw createError({ statusCode: 400 })
    return value
  }
  const query = { page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 20, 100), search: string('search', 200), status: string('status', 40), customerId: string('customerId', 16), ...(resource === 'receivable' || ['customer','contract'].includes(resource) ? { contractId: string('contractId', 16) } : { opportunityId: string('opportunityId', 16) }) }
  if ([query.customerId, 'contractId' in query ? query.contractId : query.opportunityId].some(id => id && !validId(id))) throw createError({ statusCode: 400 })
  const id = detail ? getRouterParam(event, resource === 'customer' ? 'customerId' : resource === 'contract' ? 'contractId' : resource === 'receivable' ? 'planId' : resource === 'lead' ? 'leadId' : resource === 'opportunity' ? 'opportunityId' : 'quotationId') || '' : ''
  if (detail && !validId(id)) throw createError({ statusCode: 400 })
  return { id, query }
}
async function directoryFact<T>(read: Promise<T>): Promise<T> {
  try { return await read } catch { throw createError({ statusCode: 503 }) }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 503 })
  return value as Record<string, unknown>
}
function projectRow(value: unknown, fields: readonly string[]) {
  const row = record(value)
  if (!validId(String(row.id))) throw createError({ statusCode: 503 })
  return Object.fromEntries(fields.filter(key => key in row).map(key => {
    const value = row[key]
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw createError({ statusCode: 503 })
    return [key, value]
  }))
}
export function projectAltocReadData(value: unknown, resource: AltocReadResource, detail: boolean) {
  const data = record(value)
  if (!detail) {
    if (!Array.isArray(data.items) || data.items.length > 100 || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || !Number.isSafeInteger(data.pageSize) || Number(data.pageSize) < 1 || Number(data.pageSize) > 100) throw createError({ statusCode: 503 })
    return { items: data.items.map(row => projectRow(row, altocReadFields[resource])), total: data.total, page: data.page, pageSize: data.pageSize }
  }
  const row = projectRow(data, altocReadFields[resource])
  if (resource === 'contract') for (const [key, fields] of Object.entries(altocContractChildFields)) {
    if (!Array.isArray(data[key])) throw createError({ statusCode: 503 })
    row[key] = (data[key] as unknown[]).map(child => projectRow(child, fields))
  }
  if (resource === 'quotation') {
    if (!Array.isArray(data.items) || data.items.length > 1000) throw createError({ statusCode: 503 })
    row.items = data.items.map(child => { const item = projectRow(child, altocQuotationItemFields); if (String(item.quotation_id) !== String(row.id)) throw createError({ statusCode: 503 }); return item })
  }
  return row
}

export async function enterpriseAltocRead(event: H3Event, resource: AltocReadResource, detail = false) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  try {
    const user = await requireEnterpriseUser(event)
    const input = readInput(event, resource, detail)
    const operation = `altoc.${resource}-${detail ? 'view' : 'list'}` as `altoc.${AltocReadResource}-${'list' | 'view'}`
    // Prepare transport before the current scoped permit's short lifetime starts.
    await prepareEnterpriseRuntime(event, operation)
    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'altoc', event)
    if (!authorizationResourcesAllow(snapshot.resources, resource, 'view', snapshot.actionPolicies?.[resource])) throw createError({ statusCode: 403 })
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'altoc', { resourceCode: resource, action: 'view' })
    const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
    if (scoped.uid !== user.uid || scoped.appCode !== 'altoc' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision) || scoped.policyRevision! < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw createError({ statusCode: 503 })
    const admin = hasAltocGlobalAdminRole(scoped.roles)
    if (!admin && !evaluateFoundationScopedAuthorization({ grants: scoped.grants.map(grant => ({ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] })), required: { appCode: 'altoc', resourceCode: resource, action: 'view' }, policyOf: () => scoped.actionPolicy }).allowed) throw createError({ statusCode: 403 })
    // Directory facts are current Console reads, never browser query or role simulation headers.
    const currentDeptCodes: string[] = []
    const needsSelfDepartments = !admin && scoped.grants.some(grant => [...(grant.scopes || []), ...(grant.defaultScopes || []), ...(grant.assignmentScopes || [])].some(scope => scope.dimension === 'department' && scope.predicate === 'self' && !scope.value))
    if (needsSelfDepartments) {
      const departments = await directoryFact(fetchConsoleDirectoryApi<{ code: number, data?: { departments?: { deptCode: string }[], primaryDeptCode?: string } }>('/user-departments', { event, params: { uid: user.uid } }))
      if (departments.code !== 0 || !Array.isArray(departments.data?.departments)) throw createError({ statusCode: 503 })
      currentDeptCodes.push(...departments.data.departments.map(dept => dept.deptCode), ...(departments.data.primaryDeptCode ? [departments.data.primaryDeptCode] : []))
    }
    let departmentTreeCodesByRoot
    if (!admin && scopedGrantsNeedAltocDepartmentTree(scoped.grants)) {
      const tree = await directoryFact(fetchConsoleDirectoryApi<{ code: number, data?: { tree?: AltocDepartmentScopeTreeNode[] } }>('/departments', { event }))
      if (tree.code !== 0 || !Array.isArray(tree.data?.tree)) throw createError({ statusCode: 503 })
      departmentTreeCodesByRoot = buildAltocDepartmentTreeCodeIndex(tree.data.tree)
    }
    const compiled = resolveAltocDataAccessQueryFromScopedGrants({ appCode: 'altoc', grants: scoped.grants, currentDeptCodes, resource, action: 'view', actionPolicy: scoped.actionPolicy, hasGlobalAdminRole: admin, departmentTreeCodesByRoot })
    const access = String(compiled.current_user_altoc_access || '')
    if (!['all', 'self', 'dept', 'self_dept'].includes(access)) throw createError({ statusCode: 403 })
    const departmentCodes = String(compiled.current_user_altoc_dept_codes || '').split(',').filter(Boolean)
    if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
    const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: 'view', operation: detail ? 'view' : 'list', objectId: input.id, query: input.query, allowed: true, scope: { access, departmentCodes }, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, expiresAt }
    const result = await callEnterpriseRuntime<{ code: number, data: unknown }>(event, operation, { ...input, authorization })
    if (result.code !== 0 || detail && String(record(result.data).id) !== input.id) throw createError({ statusCode: 503 })
    if (!detail && (record(result.data).page !== input.query.page || record(result.data).pageSize !== input.query.pageSize)) throw createError({ statusCode: 503 })
    return { code: 0, data: projectAltocReadData(result.data, resource, detail) }
  } catch (error) {
    const status = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status)
    const statusCode = [400, 401, 403, 404].includes(status) ? status : 503
    throw createError({ statusCode, message: ({ 400: '读取参数无效', 401: '请先登录', 403: '无查看权限', 404: '记录不存在或不可访问', 503: '经营资料暂不可用，请稍后重试' } as Record<number, string>)[statusCode] })
  }
}
