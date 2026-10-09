import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { buildAltocDepartmentTreeCodeIndex, hasAltocGlobalAdminRole, resolveAltocDataAccessQueryFromScopedGrants, scopedGrantsNeedAltocDepartmentTree, type AltocDepartmentScopeTreeNode } from '../../../altoc/server/utils/altocDataAccessScope'
import { altocReadFields, altocContractChildFields, altocQuotationItemFields, type AltocReadResource } from '../../shared/altoc-basic-read'

import { w3SnapshotFields, w3SourceFields } from '../../shared/w3-read-projection'

const idPattern = /^[1-9]\d{0,15}$/
function validId(id: string) {
  return idPattern.test(id) && Number.isSafeInteger(Number(id))
}
function readInput(event: H3Event, resource: AltocReadResource, detail: boolean, contactsOnly = false) {
  const raw = getQuery(event)
  if (detail && !contactsOnly && Object.keys(raw).some(key => key !== 'workspace')) throw createError({ statusCode: 400 })
  const allowed = ['page', 'pageSize', 'search', 'status', ...(!['customer', 'lead'].includes(resource) ? ['customerId'] : []), ...(resource === 'receivable' ? ['contractId'] : []), ...(resource === 'quotation' ? ['opportunityId'] : []), ...(resource === 'customer' ? ['parentId', 'rootsOnly', 'ownerUnassigned', 'ownerUid', 'industryCode', 'regionCode', 'updatedDateFrom', 'updatedDateTo', 'customerSort', ...(detail ? ['workspace'] : []), ...(contactsOnly ? ['decisionRole', 'primaryOnly', 'starredOnly'] : [])] : resource === 'contract' ? ['includeDescendants', 'origin', 'category', 'ownerUnassigned', 'parentContractId', 'customerIds', 'signedDateFrom', 'signedDateTo', 'ownerUid', 'amountMin', 'amountMax', 'direction', 'contractType'] : [])]
  for (const [key, value] of Object.entries(raw)) if (!allowed.includes(key) || typeof value !== 'string' || !value.trim()) throw createError({ statusCode: 400 })
  const integer = (key: string, fallback: number, max: number) => {
    const value = raw[key]
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw createError({ statusCode: 400 })
    return Number(value)
  }
  const string = (key: string, max: number) => {
    const value = String(raw[key] || '').trim()
    if (new TextEncoder().encode(value).length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw createError({ statusCode: 400 })
    return value
  }
  const query = { page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 20, 100), search: string('search', 200), status: string('status', 40), customerId: string('customerId', 16), ...(resource === 'receivable' || ['customer', 'contract'].includes(resource) ? { contractId: string('contractId', 16) } : { opportunityId: string('opportunityId', 16) }) }
  const flag = (key: string) => {
    if (raw[key] !== undefined && !['true', 'false'].includes(String(raw[key]))) throw createError({ statusCode: 400 })
    return raw[key] === 'true'
  }
  const extras = resource === 'customer' ? { ...(flag('workspace') ? { workspace: true } : {}), ...(contactsOnly ? { contactsOnly: true, ...(raw.decisionRole ? { decisionRole: string('decisionRole', 64) } : {}), ...(flag('primaryOnly') ? { primaryOnly: true } : {}), ...(flag('starredOnly') ? { starredOnly: true } : {}) } : {}), ...Object.fromEntries(['industryCode', 'regionCode', 'updatedDateFrom', 'updatedDateTo', 'customerSort'].filter(key => raw[key]).map(key => [key, string(key, 64)])), ...(raw.parentId ? { parentId: string('parentId', 16) } : {}), ...(flag('rootsOnly') ? { rootsOnly: true } : {}), ...(flag('ownerUnassigned') ? { ownerUnassigned: true } : {}) } : resource === 'contract' ? { ...(flag('includeDescendants') ? { includeDescendants: true } : {}), ...(flag('ownerUnassigned') ? { ownerUnassigned: true } : {}), ...(raw.origin ? { origin: string('origin', 32) } : {}), ...(raw.category ? { category: string('category', 64) } : {}), ...(raw.parentContractId ? { parentContractId: string('parentContractId', 16) } : {}), ...(raw.customerIds ? { customerIds: string('customerIds', 1699) } : {}), ...(raw.signedDateFrom ? { signedDateFrom: string('signedDateFrom', 10) } : {}), ...(raw.signedDateTo ? { signedDateTo: string('signedDateTo', 10) } : {}) } : {}
  if (('parentId' in extras && extras.parentId && !validId(extras.parentId)) || ('rootsOnly' in extras && extras.rootsOnly && 'parentId' in extras && extras.parentId) || ('origin' in extras && extras.origin && !['native', 'historical_import'].includes(extras.origin)) || ('includeDescendants' in extras && extras.includeDescendants && !query.customerId)) throw createError({ statusCode: 400 })
  for (const key of ['signedDateFrom', 'signedDateTo', 'ownerUid', 'amountMin', 'amountMax', 'direction', 'contractType'] as const) if (key in extras) {
    const value = String((extras as Record<string, unknown>)[key])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw createError({ statusCode: 400 })
  }
  if ('signedDateFrom' in extras && 'signedDateTo' in extras && String(extras.signedDateFrom) > String(extras.signedDateTo)) throw createError({ statusCode: 400 })
  if ('parentContractId' in extras && !validId(String(extras.parentContractId))) throw createError({ statusCode: 400 })
  if ('customerIds' in extras) {
    const ids = String(extras.customerIds).split(',')
    if (query.customerId || ('includeDescendants' in extras && extras.includeDescendants) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !validId(id))) throw createError({ statusCode: 400 })
  }
  if ([query.customerId, 'contractId' in query ? query.contractId : query.opportunityId].some(id => id && !validId(id))) throw createError({ statusCode: 400 })
  const id = detail ? getRouterParam(event, resource === 'customer' ? 'customerId' : resource === 'contract' ? 'contractId' : resource === 'receivable' ? 'planId' : resource === 'lead' ? 'leadId' : resource === 'opportunity' ? 'opportunityId' : 'quotationId') || '' : ''
  if (detail && !validId(id)) throw createError({ statusCode: 400 })
  const filters = resource === 'contract' || resource === 'customer' ? Object.fromEntries((resource === 'customer' ? ['ownerUid'] : ['ownerUid', 'amountMin', 'amountMax', 'direction', 'contractType']).filter(key => raw[key]).map(key => [key, string(key, key === 'ownerUid' ? 128 : 64)])) : {}
  for (const key of ['amountMin', 'amountMax']) if (filters[key] && !/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(filters[key]!)) throw createError({ statusCode: 400 })
  const cents = (v: string) => BigInt(v.split('.')[0]!) * 100n + BigInt(((v.split('.')[1] || '') + '00').slice(0, 2))
  if (filters.amountMin && filters.amountMax && cents(filters.amountMin) > cents(filters.amountMax)) throw createError({ statusCode: 400 })
  if ((filters.ownerUid && 'ownerUnassigned' in extras && extras.ownerUnassigned) || (filters.direction && !['sales', 'purchase'].includes(filters.direction))) throw createError({ statusCode: 400 })
  for (const key of ['updatedDateFrom', 'updatedDateTo']) if (raw[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw[key])) || String(raw[key]) < '1000-01-01' || !Number.isFinite(Date.parse(String(raw[key]))) || new Date(String(raw[key])).toISOString().slice(0, 10) !== raw[key])) throw createError({ statusCode: 400 })
  if (raw.updatedDateFrom && raw.updatedDateTo && String(raw.updatedDateFrom) > String(raw.updatedDateTo)) throw createError({ statusCode: 400 })
  if (raw.customerSort && !['updated_desc', 'updated_asc', 'id_asc'].includes(String(raw.customerSort))) throw createError({ statusCode: 400 })
  if (contactsOnly && ['parentId', 'rootsOnly', 'ownerUnassigned', 'ownerUid', 'industryCode', 'regionCode', 'updatedDateFrom', 'updatedDateTo', 'customerSort'].some(key => raw[key] !== undefined)) throw createError({ statusCode: 400 })
  return { id, query: { ...query, ...extras, ...filters } }
}
async function directoryFact<T>(read: Promise<T>): Promise<T> {
  try {
    return await read
  } catch {
    throw createError({ statusCode: 503 })
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 503 })
  return value as Record<string, unknown>
}
function projectRow(value: unknown, fields: readonly string[]) {
  const row = record(value)
  if (!validId(String(row.id))) throw createError({ statusCode: 503 })
  return Object.fromEntries(fields.filter(key => key in row).map((key) => {
    const value = row[key]
    if ((value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value))) throw createError({ statusCode: 503 })
    return [key, value]
  }))
}
function projectW3Row(value: unknown, resource: AltocReadResource) {
  const row = projectRow(value, altocReadFields[resource])
  if (resource === 'contract' && row.customer_visible !== true) {
    row.customer_visible = false
    row.customer_name = null
  }
  if (resource !== 'customer' && resource !== 'contract') return row
  const source = record(value)
  const scalar = (value: unknown, fields: readonly string[]) => {
    const object = record(value)
    return Object.fromEntries(fields.filter(key => key in object).map((key) => {
      const v = object[key]
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw createError({ statusCode: 503 })
      return [key, v]
    }))
  }
  if (source.source_info !== undefined) row.source_info = scalar(source.source_info, w3SourceFields)
  if (source.migration_snapshot !== undefined) row.migration_snapshot = scalar(source.migration_snapshot, w3SnapshotFields[resource])
  if (resource === 'customer') {
    for (const key of ['hasHiddenChildren', 'parentHidden']) if (key in source && typeof source[key] !== 'boolean') throw createError({ statusCode: 503 })
    if (source.parent !== undefined) row.parent = projectRow(source.parent, ['id', 'name'])
    if (source.ancestors !== undefined) {
      if (!Array.isArray(source.ancestors) || source.ancestors.length > 10) throw createError({ statusCode: 503 })
      row.ancestors = source.ancestors.map(parent => projectRow(parent, ['id', 'name']))
    }
  }
  return row
}
function projectContractTotals(value: unknown) {
  const source = record(value)
  const result: Record<string, unknown> = {}
  for (const key of ['count', 'terminatedCount', 'excluded']) if (key in source) {
    if (key === 'excluded' ? typeof source[key] !== 'boolean' : !Number.isSafeInteger(source[key]) || Number(source[key]) < 0) throw createError({ statusCode: 503 })
    result[key] = source[key]
  }
  for (const key of ['amounts', 'effectiveAmounts', 'signedLast12Months', 'signedThisYear']) if (key in source) {
    if (!Array.isArray(source[key]) || source[key].length > 100) throw createError({ statusCode: 503 })
    result[key] = source[key].map((value: unknown) => {
      const row = record(value)
      if (typeof row.currency_code !== 'string' || typeof row.amount !== 'string' || !Number.isSafeInteger(row.count) || Number(row.count) < 0 || ('missingCount' in row && (!Number.isSafeInteger(row.missingCount) || Number(row.missingCount) < 0))) throw createError({ statusCode: 503 })
      return Object.fromEntries(['currency_code', 'amount', 'count', 'missingCount'].filter(field => field in row).map(field => [field, row[field]]))
    })
  }
  return result
}
export function projectAltocReadData(value: unknown, resource: AltocReadResource, detail: boolean) {
  const data = record(value)
  if (!detail) {
    if (!Array.isArray(data.items) || data.items.length > 100 || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || !Number.isSafeInteger(data.pageSize) || Number(data.pageSize) < 1 || Number(data.pageSize) > 100) throw createError({ statusCode: 503 })
    return { items: data.items.map(row => projectW3Row(row, resource)), total: data.total, page: data.page, pageSize: data.pageSize, ...(resource === 'contract' && data.summary !== undefined ? { summary: projectContractTotals(data.summary) } : {}), ...(resource === 'contract' && data.customerSummaries !== undefined
      ? { customerSummaries: (() => {
          const summaries = record(data.customerSummaries)
          if (Object.keys(summaries).length > 100) throw createError({ statusCode: 503 })
          return Object.fromEntries(Object.entries(summaries).map(([id, totals]) => {
            if (!validId(id)) throw createError({ statusCode: 503 })
            return [id, projectContractTotals(totals)]
          }))
        })() }
      : {}), ...(resource === 'contract' && data.rollup !== undefined ? { rollup: projectContractTotals(data.rollup) } : {}) }
  }
  const row = projectW3Row(data, resource)
  if (resource === 'opportunity' && data.stages !== undefined) {
    if (!Array.isArray(data.stages) || data.stages.length > 100) throw createError({ statusCode: 503 })
    row.stages = data.stages.map(stage => projectRow(stage, ['id', 'code', 'name', 'stage_kind']))
  }
  if (resource === 'customer') for (const key of ['contacts', 'invoice_profiles']) {
    if (!Array.isArray(data[key])) throw createError({ statusCode: 503 })
    const fields = key === 'contacts' ? ['id', 'code', 'row_version', 'customer_id', 'star_level', 'is_key_contact', 'name', 'dept_name', 'job_title', 'mobile', 'alternate_mobile', 'phone', 'email', 'wechat', 'mailing_address', 'decision_role', 'influence_level', 'remark', 'status'] : ['id', 'code', 'row_version', 'customer_id', 'taxpayer_name', 'taxpayer_no', 'registered_address', 'registered_phone', 'bank_name', 'bank_account', 'invoice_type', 'invoice_email', 'receiver_name', 'receiver_phone', 'receiver_address', 'is_default', 'status', 'remark']
    row[key] = (data[key] as unknown[]).map((child) => {
      const projected = projectRow(child, fields)
      if (key === 'contacts' && record(child).source_info !== undefined) {
        const info = record(record(child).source_info)
        projected.source_info = Object.fromEntries(w3SourceFields.filter(field => field in info).map((field) => {
          if (typeof info[field] !== 'string') throw createError({ statusCode: 503 })
          return [field, info[field]]
        }))
      }
      if (String(projected.customer_id) !== String(row.id)) throw createError({ statusCode: 503 })
      return projected
    })
  }
  if (resource === 'contract') for (const [key, fields] of Object.entries(altocContractChildFields)) {
    if (!Array.isArray(data[key])) throw createError({ statusCode: 503 })
    row[key] = (data[key] as unknown[]).map(child => projectRow(child, fields))
  }
  if (resource === 'quotation') {
    if (!Array.isArray(data.items) || data.items.length > 1000) throw createError({ statusCode: 503 })
    row.items = data.items.map((child) => {
      const item = projectRow(child, altocQuotationItemFields)
      if (String(item.quotation_id) !== String(row.id)) throw createError({ statusCode: 503 })
      return item
    })
  }
  return row
}

async function scopedReadAuthorization(event: H3Event, user: Awaited<ReturnType<typeof requireEnterpriseUser>>, resource: AltocReadResource, readOperation: string, objectId: string, query: Record<string, unknown>) {
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
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: 'view', operation: readOperation, objectId, query, allowed: true, scope: { access, departmentCodes }, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, expiresAt }
}

export function projectCustomerContactPage(value: unknown, customerId: string, query: { page: number, pageSize: number }) {
  const data = record(value)
  if (String(data.id) !== customerId || !Array.isArray(data.items) || data.items.length > query.pageSize || data.page !== query.page || data.pageSize !== query.pageSize || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw createError({ statusCode: 503 })
  return { id: customerId, items: data.items.map((value) => {
    const row = record(value)
    const projected = projectRow(row, ['id', 'code', 'row_version', 'customer_id', 'star_level', 'is_key_contact', 'name', 'dept_name', 'job_title', 'mobile', 'alternate_mobile', 'phone', 'email', 'wechat', 'mailing_address', 'decision_role', 'influence_level', 'remark', 'status'])
    if (String(projected.customer_id) !== customerId) throw createError({ statusCode: 503 })
    if (row.source_info !== undefined) projected.source_info = Object.fromEntries(w3SourceFields.filter(key => key in record(row.source_info)).map((key) => {
      const value = record(row.source_info)[key]
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw createError({ statusCode: 503 })
      return [key, value]
    }))
    return projected
  }), total: data.total, page: data.page, pageSize: data.pageSize }
}

export async function enterpriseAltocRead(event: H3Event, resource: AltocReadResource, detail = false, owningId?: string, contactsOnly = false) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  try {
    const user = await requireEnterpriseUser(event)
    const input = owningId === undefined ? readInput(event, resource, detail, contactsOnly) : { id: owningId, query: { page: 1, pageSize: 20, search: '', status: '', customerId: '', ...(['customer', 'contract', 'receivable'].includes(resource) ? { contractId: '' } : { opportunityId: '' }) } }
    if (owningId !== undefined && (!detail || !validId(owningId))) throw createError({ statusCode: 400 })
    const operation = `altoc.${resource}-${detail ? 'view' : 'list'}` as `altoc.${AltocReadResource}-${'list' | 'view'}`
    // Prepare transport before the current scoped permit's short lifetime starts.
    await prepareEnterpriseRuntime(event, operation)
    const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'altoc', event)
    if (!authorizationResourcesAllow(snapshot.resources, resource, 'view', snapshot.actionPolicies?.[resource])) throw createError({ statusCode: 403 })
    const authorization = await scopedReadAuthorization(event, user, resource, detail ? 'view' : 'list', input.id, input.query)
    let customerRead
    if (resource === 'contract' && authorizationResourcesAllow(snapshot.resources, 'customer', 'view', snapshot.actionPolicies?.customer)) {
      try {
        customerRead = await scopedReadAuthorization(event, user, 'customer', 'list', '', { page: 1, pageSize: 20, search: '', status: '', customerId: '', contractId: '' })
      } catch (error) {
        if (Number((error as { statusCode?: number }).statusCode) !== 403) throw error
      }
      if (customerRead) {
        if (customerRead.bundleVersion !== authorization.bundleVersion || customerRead.bundleHash !== authorization.bundleHash || customerRead.policyRevision !== authorization.policyRevision) throw createError({ statusCode: 503 })
        authorization.expiresAt = customerRead.expiresAt = Math.min(authorization.expiresAt, customerRead.expiresAt)
      }
    }
    if (authorization.expiresAt <= Date.now()) throw createError({ statusCode: 503 })
    const result = await callEnterpriseRuntime<{ code: number, data: unknown }>(event, operation, { ...input, authorization: { ...authorization, ...(customerRead ? { customerRead } : {}) } })
    if (result.code !== 0 || (detail && String(record(result.data).id) !== input.id)) throw createError({ statusCode: 503 })
    if (!detail && (record(result.data).page !== input.query.page || record(result.data).pageSize !== input.query.pageSize)) throw createError({ statusCode: 503 })
    return { code: 0, data: contactsOnly ? projectCustomerContactPage(result.data, input.id, input.query) : projectAltocReadData(result.data, resource, detail) }
  } catch (error) {
    const status = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status)
    const statusCode = [400, 401, 403, 404, 422].includes(status) ? status : 503
    throw createError({ statusCode, message: ({ 400: '读取参数无效', 401: '请先登录', 403: '无查看权限', 404: '记录不存在或不可访问', 422: '下属层级过深或数量过多，请缩小查询范围', 503: '经营资料暂不可用，请稍后重试' } as Record<number, string>)[statusCode] })
  }
}
