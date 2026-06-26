import { createError, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import {
  isTenantRuntimeEnabled,
  maybeCallTenantRuntime,
  type TenantRuntimeCallOptions,
  type TenantRuntimeHandled,
  type TenantRuntimeMethod,
  type TenantRuntimeSkipped
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { approvalTargets, type ApprovalTargetConfig } from './financeApproval'
import { createLocalWorkflowFallback, createWorkflowApprovalInstance } from './financeWorkflow'
import { getFinanceConsoleAuth, getRequestUid } from './authIdentity'
import {
  resolveFinanceContractSummaryAccessQuery,
  resolveFinanceDashboardAccessQuery,
  resolveFinanceExpenseRequestAccessQuery,
  resolveFinancePerformanceAccessQuery,
  resolveFinanceProjectAccountingAccessQuery
} from './financeScopedAuthorization'

type DataRuntimeCallOptions = Omit<TenantRuntimeCallOptions, 'appCode'>
type DataRuntimeMethod = TenantRuntimeMethod
type DataRuntimeSkipped = TenantRuntimeSkipped
type DataRuntimeHandled<T> = TenantRuntimeHandled<T>

type RuntimeDataEnvelope<T> = {
  data?: T
}

type SubmitApprovalRuntimeTarget = {
  pattern: RegExp
  detailPath: (code: string) => string
  readScope: string
  target: ApprovalTargetConfig
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function runtimeConfig() {
  return useRuntimeConfig() as unknown as Record<string, unknown>
}

const readScopeByPath: Record<string, string> = {
  '/v1/finance/accounting-objects': 'finance.accounting_objects.read',
  '/v1/finance/audit-logs': 'finance.audit_logs.read',
  '/v1/finance/bank-accounts': 'finance.bank_accounts.read',
  '/v1/finance/bank-accounts/balances': 'finance.bank_accounts.read',
  '/v1/finance/bank-accounts/balance-changes': 'finance.bank_accounts.read',
  '/v1/finance/contracts/summaries': 'finance.contracts.read',
  '/v1/finance/dashboard/summary': 'finance.dashboard.read',
  '/v1/finance/employee-contributions': 'finance.employee_contributions.read',
  '/v1/finance/employee-costs': 'finance.employee_costs.read',
  '/v1/finance/expense-claims': 'finance.expense_claims.read',
  '/v1/finance/expenses': 'finance.expenses.read',
  '/v1/finance/integrations/approval-instances': 'finance.approval_instances.read',
  '/v1/finance/invoice-requests': 'finance.invoice_requests.read',
  '/v1/finance/invoices': 'finance.invoices.read',
  '/v1/finance/migrations/wizbizdb/status': 'finance.migrations.read',
  '/v1/finance/payment-requests': 'finance.payment_requests.read',
  '/v1/finance/performance': 'finance.performance.read',
  '/v1/finance/performance-rules': 'finance.performance_rules.read',
  '/v1/finance/performance/snapshots': 'finance.performance_snapshots.read',
  '/v1/finance/project-accounting': 'finance.project_accounting.read',
  '/v1/finance/project-cost-allocations': 'finance.project_cost_allocations.read',
  '/v1/finance/project-expense-requests': 'finance.project_expense_requests.read',
  '/v1/finance/receipts': 'finance.receipts.read',
  '/v1/finance/reconciliation': 'finance.reconciliation.read',
  '/v1/finance/reports': 'finance.reports.read',
  '/v1/finance/settings/expense-types': 'finance.settings.read',
  '/v1/finance/settings/income-types': 'finance.settings.read',
  '/v1/finance/settings/people-cost-parameters': 'finance.settings.read',
  '/v1/finance/settings/subject-mappings': 'finance.settings.read',
  '/v1/finance/settings/subjects': 'finance.settings.read'
}

const submitApprovalRuntimeTargets: SubmitApprovalRuntimeTarget[] = [
  {
    pattern: /^\/v1\/finance\/invoice-requests\/([^/]+)\/submit$/,
    detailPath: code => `/v1/finance/invoice-requests/${encodeURIComponent(code)}`,
    readScope: 'finance.invoice_requests.read',
    target: approvalTargets.invoice_request
  },
  {
    pattern: /^\/v1\/finance\/expense-claims\/([^/]+)\/submit$/,
    detailPath: code => `/v1/finance/expense-claims/${encodeURIComponent(code)}`,
    readScope: 'finance.expense_claims.read',
    target: approvalTargets.expense_claim
  },
  {
    pattern: /^\/v1\/finance\/project-expense-requests\/([^/]+)\/submit$/,
    detailPath: code => `/v1/finance/project-expense-requests/${encodeURIComponent(code)}`,
    readScope: 'finance.project_expense_requests.read',
    target: approvalTargets.project_expense_request
  },
  {
    pattern: /^\/v1\/finance\/payment-requests\/([^/]+)\/submit$/,
    detailPath: code => `/v1/finance/payment-requests/${encodeURIComponent(code)}`,
    readScope: 'finance.payment_requests.read',
    target: approvalTargets.payment_request
  }
]

function currentFinanceDataRuntimePath(event: H3Event) {
  const pathname = getRequestURL(event).pathname
  const marker = '/api/v1/finance'
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex >= 0) {
    return `/v1/finance${pathname.slice(markerIndex + marker.length)}`
  }
  if (pathname.startsWith('/v1/finance')) {
    return pathname
  }
  return ''
}

function currentFinanceReadScope(path: string) {
  const exactScope = readScopeByPath[path]
  if (exactScope) return exactScope
  if (/^\/v1\/finance\/bank-accounts\/[^/]+$/.test(path)) return 'finance.bank_accounts.read'
  if (/^\/v1\/finance\/bank-accounts\/[^/]+\/balance-snapshots$/.test(path)) return 'finance.bank_accounts.read'
  if (/^\/v1\/finance\/contracts\/[^/]+\/summary$/.test(path)) return 'finance.contracts.read'
  if (/^\/v1\/finance\/service\/customers\/[^/]+\/maintenance-financial-summary$/.test(path)) return 'finance.contracts.read'
  if (path === '/v1/finance/service/people-cost-parameters') return 'finance.settings.read'
  if (path === '/v1/finance/service/performance-amounts') return 'finance.performance.read'
  if (/^\/v1\/finance\/invoice-requests\/[^/]+$/.test(path)) return 'finance.invoice_requests.read'
  if (/^\/v1\/finance\/invoices\/[^/]+$/.test(path)) return 'finance.invoices.read'
  if (/^\/v1\/finance\/receipts\/[^/]+$/.test(path)) return 'finance.receipts.read'
  if (/^\/v1\/finance\/expenses\/[^/]+$/.test(path)) return 'finance.expenses.read'
  if (/^\/v1\/finance\/expense-claims\/[^/]+$/.test(path)) return 'finance.expense_claims.read'
  if (/^\/v1\/finance\/project-expense-requests\/[^/]+$/.test(path)) return 'finance.project_expense_requests.read'
  if (/^\/v1\/finance\/payment-requests\/[^/]+$/.test(path)) return 'finance.payment_requests.read'
  if (/^\/v1\/finance\/project-accounting\/[^/]+$/.test(path)) return 'finance.project_accounting.read'
  return ''
}

function currentFinanceWriteScope(path: string) {
  if (!path.startsWith('/v1/finance/')) return ''
  return 'finance.write'
}

function currentFinanceScope(path: string, method: string) {
  if (method === 'GET') return currentFinanceReadScope(path)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return currentFinanceWriteScope(path)
  return ''
}

function matchSubmitApprovalRuntimeTarget(path: string) {
  for (const item of submitApprovalRuntimeTargets) {
    const match = item.pattern.exec(path)
    if (!match) continue
    return {
      ...item,
      code: decodeURIComponent(match[1] || '')
    }
  }
  return null
}

function objectBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  return {}
}

async function prepareMutationBody(event: H3Event, path: string, method: DataRuntimeMethod, body: unknown) {
  if (method !== 'POST') return body

  const submitTarget = matchSubmitApprovalRuntimeTarget(path)
  if (!submitTarget) return body

  const payload = objectBody(body)
  if (payload.skipWorkflow === true || stringValue(payload.workflowInstanceId ?? payload.workflow_instance_id)) {
    return payload
  }

  try {
    const detail = await maybeCallFinanceDataRuntime<RuntimeDataEnvelope<Record<string, unknown>>>(
      event,
      submitTarget.detailPath(submitTarget.code),
      { scope: submitTarget.readScope, method: 'GET', query: await buildFinanceRuntimeAuthQuery(event, submitTarget.detailPath(submitTarget.code), 'GET') }
    )
    const row = detail.handled ? detail.data.data : null
    if (!row) return payload

    const submission = await createWorkflowApprovalInstance(event, submitTarget.target, row as RowDataPacket, payload)
    return {
      ...payload,
      workflowInstanceId: submission.workflowInstanceId,
      workflow_instance_id: submission.workflowInstanceId,
      externalInstanceId: submission.externalInstanceId,
      external_instance_id: submission.externalInstanceId,
      workflowPlatform: submission.platform,
      workflow_platform: submission.platform,
      workflowStatus: submission.status,
      workflow_status: submission.status,
      workflowErrorMessage: submission.errorMessage,
      workflow_error_message: submission.errorMessage
    }
  } catch (error) {
    console.warn('[Finance] Workflow submit failed before Data Runtime Agent proxying:', error)
    const fallback = createLocalWorkflowFallback(submitTarget.target, submitTarget.code, error)
    return {
      ...payload,
      workflowInstanceId: fallback.workflowInstanceId,
      workflow_instance_id: fallback.workflowInstanceId,
      externalInstanceId: fallback.externalInstanceId,
      external_instance_id: fallback.externalInstanceId,
      workflowPlatform: fallback.platform,
      workflow_platform: fallback.platform,
      workflowStatus: fallback.status,
      workflow_status: fallback.status,
      workflowErrorMessage: fallback.errorMessage,
      workflow_error_message: fallback.errorMessage
    }
  }
}

const runtimeAuthKeys = new Set([
  'current_user',
  'currentUser',
  'operator_uid',
  'operatorUid',
  'current_user_expense_request_access',
  'currentUserExpenseRequestAccess',
  'current_user_expense_request_dept_codes',
  'currentUserExpenseRequestDeptCodes',
  'current_user_expense_request_dept_code',
  'currentUserExpenseRequestDeptCode',
  'current_user_expense_claim_access',
  'currentUserExpenseClaimAccess',
  'current_user_expense_claim_dept_codes',
  'currentUserExpenseClaimDeptCodes',
  'current_user_expense_claim_dept_code',
  'currentUserExpenseClaimDeptCode',
  'current_user_project_finance_access',
  'currentUserProjectFinanceAccess',
  'current_user_project_finance_project_codes',
  'currentUserProjectFinanceProjectCodes',
  'current_user_project_accounting_access',
  'currentUserProjectAccountingAccess',
  'current_user_project_accounting_project_codes',
  'currentUserProjectAccountingProjectCodes',
  'current_user_finance_performance_access',
  'currentUserFinancePerformanceAccess',
  'current_user_finance_performance_dept_codes',
  'currentUserFinancePerformanceDeptCodes',
  'current_user_finance_performance_dept_code',
  'currentUserFinancePerformanceDeptCode',
  'current_user_performance_access',
  'currentUserPerformanceAccess',
  'current_user_performance_dept_codes',
  'currentUserPerformanceDeptCodes',
  'current_user_performance_dept_code',
  'currentUserPerformanceDeptCode'
])

function sanitizeRuntimeRecord(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (runtimeAuthKeys.has(key)) continue
    result[key] = value
  }
  return result
}

function expenseRuntimeAction(method: string) {
  return method === 'GET' ? 'view' : 'edit'
}

function projectFinanceRuntimeAction(method: string) {
  return method === 'GET' ? 'view' : 'edit'
}

function financePerformanceRuntimeAction(method: string) {
  return method === 'GET' ? 'view' : 'edit'
}

function isExpenseScopedRuntimePath(path: string) {
  return path === '/v1/finance/expenses'
    || path === '/v1/finance/expense-claims'
    || path === '/v1/finance/project-expense-requests'
    || path === '/v1/finance/payment-requests'
    || /^\/v1\/finance\/expenses\/[^/]+$/.test(path)
    || /^\/v1\/finance\/expense-claims\/[^/]+$/.test(path)
    || /^\/v1\/finance\/project-expense-requests\/[^/]+$/.test(path)
    || /^\/v1\/finance\/payment-requests\/[^/]+$/.test(path)
    || /^\/v1\/finance\/expense-claims\/[^/]+\/submit$/.test(path)
    || /^\/v1\/finance\/project-expense-requests\/[^/]+\/submit$/.test(path)
    || /^\/v1\/finance\/payment-requests\/[^/]+\/submit$/.test(path)
}

function isProjectFinanceScopedRuntimePath(path: string) {
  return path === '/v1/finance/project-accounting'
    || path === '/v1/finance/project-accounting/resolve'
    || path === '/v1/finance/project-accounting/recalculate'
    || path === '/v1/finance/project-cost-allocations'
    || path === '/v1/finance/employee-costs'
    || path === '/v1/finance/reports'
    || /^\/v1\/finance\/project-accounting\/[^/]+$/.test(path)
}

function isFinanceDashboardScopedRuntimePath(path: string) {
  return path === '/v1/finance/dashboard/summary'
}

function isFinanceContractSummaryScopedRuntimePath(path: string) {
  return path === '/v1/finance/contracts/summaries'
    || /^\/v1\/finance\/contracts\/[^/]+\/summary$/.test(path)
    || /^\/v1\/finance\/service\/customers\/[^/]+\/maintenance-financial-summary$/.test(path)
}

function isFinancePerformanceScopedRuntimePath(path: string) {
  return path === '/v1/finance/employee-contributions'
    || path === '/v1/finance/performance'
    || path === '/v1/finance/performance-rules'
    || path === '/v1/finance/performance/snapshots'
    || path === '/v1/finance/performance/recalculate'
}

function isServiceConsoleAuth(event: H3Event) {
  const auth = getFinanceConsoleAuth(event) as { tokenUse?: string, subjectType?: string } | undefined
  return auth?.tokenUse === 'service' || auth?.subjectType === 'service'
}

export async function buildFinanceRuntimeAuthQuery(
  event: H3Event,
  path: string,
  method: string,
  baseQuery: Record<string, unknown> = getQuery(event) as Record<string, unknown>
) {
  const query = sanitizeRuntimeRecord(baseQuery)
  const uid = stringValue(getRequestUid(event))
  if (!uid || isServiceConsoleAuth(event)) return query

  query.current_user = uid
  if (isExpenseScopedRuntimePath(path)) {
    Object.assign(query, await resolveFinanceExpenseRequestAccessQuery(event, uid, expenseRuntimeAction(method)))
  }
  if (isFinanceDashboardScopedRuntimePath(path)) {
    Object.assign(query, await resolveFinanceDashboardAccessQuery(event, uid, 'view'))
  } else if (isFinanceContractSummaryScopedRuntimePath(path)) {
    Object.assign(query, await resolveFinanceContractSummaryAccessQuery(event, uid, 'view'))
  } else if (isProjectFinanceScopedRuntimePath(path)) {
    Object.assign(query, await resolveFinanceProjectAccountingAccessQuery(event, uid, projectFinanceRuntimeAction(method)))
  }
  if (isFinancePerformanceScopedRuntimePath(path)) {
    Object.assign(query, await resolveFinancePerformanceAccessQuery(event, uid, financePerformanceRuntimeAction(method)))
  }
  return query
}

export function buildFinanceRuntimeAuthBody(path: string, method: string, body: unknown, authQuery: Record<string, unknown>) {
  const uid = stringValue(authQuery.current_user)
  const payload = uid ? sanitizeRuntimeRecord(objectBody(body)) : objectBody(body)
  if (!uid) return payload

  payload.current_user = uid
  payload.operator_uid = uid

  if (isProjectFinanceScopedRuntimePath(path)) {
    const access = stringValue(authQuery.current_user_project_finance_access)
    if (access) {
      payload.current_user_project_finance_access = access
    }
    const projectCodes = stringValue(authQuery.current_user_project_finance_project_codes)
    if (projectCodes) {
      payload.current_user_project_finance_project_codes = projectCodes
    }
  }

  if (isFinancePerformanceScopedRuntimePath(path)) {
    const access = stringValue(authQuery.current_user_finance_performance_access)
    if (access) {
      payload.current_user_finance_performance_access = access
    }
    const deptCodes = stringValue(authQuery.current_user_finance_performance_dept_codes)
    if (deptCodes) {
      payload.current_user_finance_performance_dept_codes = deptCodes
    }
    if (method === 'POST' && path === '/v1/finance/employee-contributions') {
      if (!stringValue(payload.employeeUid ?? payload.employee_uid) && access === 'self') {
        payload.employeeUid = uid
        payload.employee_uid = uid
      }
      if (!stringValue(payload.createdBy ?? payload.created_by)) {
        payload.createdBy = uid
        payload.created_by = uid
      }
    }
  }

  if (!isExpenseScopedRuntimePath(path)) return payload

  const access = stringValue(authQuery.current_user_expense_request_access)
  if (access) {
    payload.current_user_expense_request_access = access
  }
  const deptCodes = stringValue(authQuery.current_user_expense_request_dept_codes)
  if (deptCodes) {
    payload.current_user_expense_request_dept_codes = deptCodes
  }
  if (method === 'POST' && [
    '/v1/finance/expense-claims',
    '/v1/finance/project-expense-requests',
    '/v1/finance/payment-requests'
  ].includes(path)) {
    if (!stringValue(payload.applicantUserId ?? payload.applicant_user_id) && access === 'self') {
      payload.applicantUserId = uid
      payload.applicant_user_id = uid
    }
    if (!stringValue(payload.createdBy ?? payload.created_by)) {
      payload.createdBy = uid
      payload.created_by = uid
    }
  }
  if ((method === 'PATCH' || method === 'PUT') && !stringValue(payload.updatedBy ?? payload.updated_by)) {
    payload.updatedBy = uid
    payload.updated_by = uid
  }
  if (method === 'POST' && path.endsWith('/submit') && !stringValue(payload.submittedBy ?? payload.submitted_by)) {
    payload.submittedBy = uid
    payload.submitted_by = uid
  }
  return payload
}

export function assertFinanceRuntimeGlobalProjectAccountingAccess(
  authQuery: Record<string, unknown>,
  message = 'Project accounting scope does not allow direct employee cost access.'
) {
  const access = stringValue(authQuery.current_user_project_finance_access || authQuery.currentUserProjectFinanceAccess)
  if (access === 'all') return
  const uid = stringValue(authQuery.current_user || authQuery.currentUser || authQuery.operator_uid || authQuery.operatorUid)
  if (!access && !uid) return
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message
  })
}

export function isFinanceDataRuntimeEnabled(event: H3Event, config = runtimeConfig()) {
  return isTenantRuntimeEnabled(event, 'finance', config)
}

export async function maybeCallFinanceDataRuntime<T>(
  event: H3Event,
  path: string,
  options: DataRuntimeCallOptions
): Promise<DataRuntimeSkipped | DataRuntimeHandled<T>> {
  return maybeCallTenantRuntime<T>(event, path, {
    appCode: 'finance',
    scope: options.scope,
    method: options.method,
    query: options.query,
    body: options.body
  })
}

function normalizeDataRuntimeMethod(value: unknown): DataRuntimeMethod {
  const method = String(value || 'GET').toUpperCase()
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') return method
  return 'GET'
}

export async function maybeCallCurrentFinanceDataRuntime<T>(event: H3Event): Promise<DataRuntimeSkipped | DataRuntimeHandled<T>> {
  const path = currentFinanceDataRuntimePath(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const scope = currentFinanceScope(path, method)
  if (!path || !scope) return { handled: false }
  const normalizedMethod = normalizeDataRuntimeMethod(method)
  const query = await buildFinanceRuntimeAuthQuery(event, path, normalizedMethod)
  const rawBody = normalizedMethod === 'GET' ? undefined : await readBody(event)
  const preparedBody = normalizedMethod === 'GET' ? undefined : await prepareMutationBody(event, path, normalizedMethod, rawBody)
  const body = normalizedMethod === 'GET'
    ? undefined
    : buildFinanceRuntimeAuthBody(path, normalizedMethod, preparedBody, query)
  return maybeCallFinanceDataRuntime<T>(event, path, { scope, method: normalizedMethod, query, body })
}
