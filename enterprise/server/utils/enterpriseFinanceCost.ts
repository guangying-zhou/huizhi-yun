import { createError, getQuery, getRouterParam, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { projectPeopleReadScope, type PeopleDirectoryNode } from '@hzy/foundation/server/utils/peopleScopeProjection'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { financeProjectAccountingScopeQuery } from '../../../finance/server/utils/financeScopedAuthorization'

export const financeCostOperations = {
  'project-accounting-page': 'view',
  'project-accounting-view': 'view',
  'project-labor-preview': 'admin',
  'project-labor-recalculate': 'admin',
  'project-labor-history-page': 'view',
  'project-labor-history-view': 'view',
  'project-cost-allocations-page': 'view',
  'project-cost-allocations-view': 'view',
  'employee-costs-page': 'admin',
  'employee-costs-view': 'admin',
  'project-cost-period-view': 'view',
  'project-cost-period-confirm-zero': 'admin',
  'project-cost-period-close': 'admin'
} as const
export type FinanceCostOperation = keyof typeof financeCostOperations
export const financeCostWrite = (op: FinanceCostOperation) => ['project-labor-recalculate', 'project-cost-period-confirm-zero', 'project-cost-period-close'].includes(op)
export function normalizeFinanceCost(op: FinanceCostOperation, query: Record<string, unknown>, project: unknown, code: unknown, raw: unknown) {
  if (!Object.hasOwn(financeCostOperations, op))
    throw createError({ statusCode: 400 })
  const page = op.endsWith('-page'), write = financeCostWrite(op)
  const allowed = ['periodMonth', ...(project === undefined ? ['projectCode'] : []), ...(page ? ['page', 'pageSize', 'search'] : [])]
  if (Object.keys(query).some(k => !allowed.includes(k)) || Object.values(query).some(v => typeof v !== 'string' && typeof v !== 'number'))
    throw createError({ statusCode: 400 })
  const projectCode = String(project ?? query.projectCode ?? '')
  const periodMonth = String(query.periodMonth || '')
  if ((!projectCode && !['project-accounting-page', 'project-cost-allocations-page', 'employee-costs-page', 'employee-costs-view'].includes(op)) || (projectCode && !/^[A-Za-z0-9_-]{1,64}$/.test(projectCode)) || !/^(?:20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(periodMonth))
    throw createError({ statusCode: 400 })
  const needsCode = ['project-labor-history-view', 'project-cost-allocations-view', 'employee-costs-view'].includes(op)
  if (needsCode !== (code !== undefined) || (needsCode && !/^[A-Za-z0-9_-]{1,64}$/.test(String(code))))
    throw createError({ statusCode: 400 })
  if (op === 'employee-costs-view' && !/^[1-9]\d*$/.test(String(code)))
    throw createError({ statusCode: 400 })
  const body = raw as Record<string, unknown>
  if (write && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['expectedVersion', 'expectedInputHash'].includes(k)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || (typeof body.expectedInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputHash))))
    throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const value = v ?? fallback
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
      throw createError({ statusCode: 400 })
    return Number(value)
  }
  const search = String(query.search || '')
  if (search.length > 200 || search.includes('\0') || /[\r\n]/.test(search))
    throw createError({ statusCode: 400 })
  return { projectCode, periodMonth, code: String(code || ''), page: page ? integer(query.page, 1, 1000000) : 0, pageSize: page ? integer(query.pageSize, 20, 100) : 0, search, expectedVersion: write ? Number(body.expectedVersion) : 0, expectedInputHash: write ? String(body.expectedInputHash) : '' }
}
export async function enterpriseFinanceCost(event: H3Event, operation: FinanceCostOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const write = financeCostWrite(operation)
  const cost = normalizeFinanceCost(operation, getQuery(event), getRouterParam(event, 'projectCode'), getRouterParam(event, 'code'), write ? await readBody(event) : {})
  const key = write ? getHeader(event, 'idempotency-key') : undefined
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)))
    throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  const action = financeCostOperations[operation]
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'project_accounting', action })
  const valid = (s: typeof scoped, app: string) => s.uid === user.uid && s.appCode === app && !!s.bundleVersion && !!s.bundleHash && Number.isSafeInteger(s.policyRevision) && (s.authorizationExpiresAt ?? 0) > Date.now()
  if (!valid(scoped, 'finance'))
    throw createError({ statusCode: 503 })
  const projection = financeProjectAccountingScopeQuery(scoped, action)
  const access = projection.current_user_project_finance_access
  const projectCodes = access === 'projects' ? String(projection.current_user_project_finance_project_codes).split(',').sort() : []
  if ((access !== 'all' && access !== 'projects') || (access === 'projects' && cost.projectCode && !projectCodes.includes(cost.projectCode)))
    throw createError({ statusCode: 403 })
  let salary: {
    access: 'all' | 'self' | 'dept' | 'self_dept' | 'none'
    departmentCodes: string[]
  } = { access: 'none', departmentCodes: [] }
  let expiresAt = scoped.authorizationExpiresAt ?? 0
  // Public summary/allocations never depend on access to personal salary.
  if (operation.startsWith('employee-costs-')) {
    const people = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'people', { resourceCode: 'standard_costs', action: 'view' })
    if (!valid(people, 'people') || people.bundleVersion !== scoped.bundleVersion || people.bundleHash !== scoped.bundleHash || people.policyRevision !== scoped.policyRevision)
      throw createError({ statusCode: 503 })
    const needTree = people.grants.some(g => [...g.defaultScopes || [], ...g.assignmentScopes || [], ...g.scopes || []].some(s => s.dimension === 'department'))
    const tree = needTree
      ? (await fetchConsoleDirectoryApi<{
          data: {
            tree: PeopleDirectoryNode[]
          }
        }>('/departments', { event })).data?.tree
      : []
    if (!Array.isArray(tree))
      throw createError({ statusCode: 503 })
    const projected = projectPeopleReadScope({ grants: people.grants, required: { appCode: 'people', resourceCode: 'standard_costs', action: 'view' }, policyOf: () => people.actionPolicy }, user.uid, tree)
    if (!projected)
      throw createError({ statusCode: 503 })
    if (projected.access === 'none')
      throw createError({ statusCode: 403 })
    salary = projected
    expiresAt = Math.min(expiresAt, people.authorizationExpiresAt ?? 0)
  }
  const op = `finance.14c-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  expiresAt = Math.min(expiresAt, enterpriseRuntimePermitExpiresAt())
  if (expiresAt <= Date.now())
    throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'project_accounting', action, operation, objectId: `${cost.projectCode}|${cost.periodMonth}|${cost.code}`, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'none', departmentCodes: [] }, costScope: { access, projectCodes, salary } }
  const response = await callEnterpriseRuntime<{
    code: number
    data: unknown
  }>(event, op, { cost, authorization }, { idempotencyKey: key })
  if (response.code !== 0 || !response.data || typeof response.data !== 'object')
    throw createError({ statusCode: 503 })
  return financeCostPublicResponse(operation, response.data as Record<string, unknown>)
}
// Defense in depth: private calculation evidence can never reach a Host response.
export function financeCostPublicResponse(operation: FinanceCostOperation, source: Record<string, unknown>) {
  if (operation === 'project-labor-preview' || financeCostWrite(operation)) {
    if (typeof source.projectCode !== 'string' || typeof source.periodMonth !== 'string' || !Number.isSafeInteger(source.expectedVersion) || Number(source.expectedVersion) < 0 || typeof source.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.inputHash) || !['ready', 'not_ready'].includes(String(source.readiness)) || !Array.isArray(source.missingInputs) || source.missingInputs.some(v => typeof v !== 'string') || typeof source.closed !== 'boolean') throw createError({ statusCode: 503 })
    const keys = ['projectCode', 'periodMonth', 'expectedVersion', 'inputHash', 'currency', 'laborCostAmount', 'readiness', 'missingInputs', 'batchCode', 'closed']
    return { data: Object.fromEntries(keys.filter(k => Object.hasOwn(source, k)).map(k => [k, source[k]])) }
  }
  const keys = ['id', 'code', 'project_code', 'project_name', 'period_month', 'currency_code', 'labor_cost_amount', 'cost_readiness_status', 'cost_missing_inputs_json', 'current_batch_code', 'row_version', 'receipt_amount', 'direct_expense_amount', 'other_cost_amount', 'gross_profit_amount', 'gross_margin_rate', 'revision', 'input_sha256', 'formula_version', 'readiness_status', 'missing_inputs_json', 'calculated_by', 'allocation_type', 'amount', 'allocation_basis', 'basis_value', 'rule_code', 'batch_code', 'status']
  if (operation.startsWith('employee-costs-'))
    keys.push('employee_uid', 'standard_cost_amount', 'people_snapshot_code')
  const row = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return null
    const v = raw as Record<string, unknown>
    return { ...Object.fromEntries(keys.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]])), ...(Object.hasOwn(v, 'closed_at IS NOT NULL') ? { closed: !!Number(v['closed_at IS NOT NULL']), zeroConfirmed: !!Number(v['zero_confirmed_at IS NOT NULL']) } : {}), ...(Object.hasOwn(v, 'CAST(created_at AS CHAR)') ? { created_at: v['CAST(created_at AS CHAR)'] } : {}) }
  }
  if (operation.endsWith('-page')) {
    if (!Array.isArray(source.data) || source.data.some(v => !v || typeof v !== 'object' || Array.isArray(v)) || !Number.isSafeInteger(source.total) || Number(source.total) < 0 || !Number.isSafeInteger(source.page) || !Number.isSafeInteger(source.pageSize))
      throw createError({ statusCode: 503 })
    return { data: source.data.map(row), total: source.total, page: source.page, pageSize: source.pageSize }
  }
  if (!Object.hasOwn(source, 'data') || (source.data !== null && (typeof source.data !== 'object' || Array.isArray(source.data)))) throw createError({ statusCode: 503 })
  return { data: row(source.data) }
}
