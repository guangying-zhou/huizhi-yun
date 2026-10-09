import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { resolveFinanceResponsibilityAccessFromGrants } from '../../../finance/server/utils/financeScopedAuthorization'
import { fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'

export const financeLedgerOperations = {
  'historical-finance-page': { resource: 'historical_finance', action: 'view', write: false },
  'historical-finance-preview': { resource: 'historical_finance', action: 'view', write: false },
  'historical-finance-activate': { resource: 'historical_finance', action: 'activate', write: true },
  'historical-finance-history-page': { resource: 'historical_finance', action: 'view', write: false },
  'allocation-candidates': { resource: 'reconciliation', action: 'view', write: false },
  'allocation-batches-page': { resource: 'reconciliation', action: 'view', write: false },
  'allocation-batches-detail': { resource: 'reconciliation', action: 'view', write: false },
  'reconciliation-allocate-batch': { resource: 'reconciliation', action: 'confirm', write: true },
  'allocation-batches-reverse': { resource: 'reconciliation', action: 'confirm', write: true },
  'receivable-adjustments-page': { resource: 'receivable_adjustments', action: 'view', write: false },
  'receivable-adjustments-detail': { resource: 'receivable_adjustments', action: 'view', write: false },
  'receivable-adjustments-create': { resource: 'receivable_adjustments', action: 'edit', write: true },
  'receivable-adjustments-confirm': { resource: 'receivable_adjustments', action: 'confirm', write: true },
  'receivable-adjustments-reverse': { resource: 'receivable_adjustments', action: 'reverse', write: true },

  'payment-requests-page': { resource: 'expenses', action: 'view', write: false },
  'payment-requests-detail': { resource: 'expenses', action: 'view', write: false },
  'payment-requests-create': { resource: 'expenses', action: 'edit', write: true },
  'payment-requests-update': { resource: 'expenses', action: 'edit', write: true },
  'payment-requests-cancel': { resource: 'expenses', action: 'edit', write: true },
  'payment-requests-submit': { resource: 'expenses', action: 'edit', write: true },
  'payment-requests-confirm': { resource: 'expenses', action: 'confirm', write: true },
  'expense-types-page': { resource: 'settings', action: 'admin', write: false },
  'expense-types-create': { resource: 'settings', action: 'admin', write: true },
  'expense-types-update': { resource: 'settings', action: 'admin', write: true },
  'income-types-page': { resource: 'settings', action: 'admin', write: false },
  'income-types-create': { resource: 'settings', action: 'admin', write: true },
  'income-types-update': { resource: 'settings', action: 'admin', write: true },
  'subjects-page': { resource: 'settings', action: 'admin', write: false },
  'subjects-create': { resource: 'settings', action: 'admin', write: true },
  'subjects-update': { resource: 'settings', action: 'admin', write: true },
  'subject-mappings-page': { resource: 'settings', action: 'admin', write: false },
  'subject-mappings-create': { resource: 'settings', action: 'admin', write: true },
  'subject-mappings-update': { resource: 'settings', action: 'admin', write: true },
  'accounting-objects-page': { resource: 'settings', action: 'admin', write: false },
  'accounting-objects-create': { resource: 'settings', action: 'admin', write: true },
  'accounting-objects-update': { resource: 'settings', action: 'admin', write: true },
  'audit-logs-page': { resource: 'settings', action: 'admin', write: false },
  'approval-instances-page': { resource: 'settings', action: 'admin', write: false },

  'expenses-page': { resource: 'expenses', action: 'view', write: false },
  'expenses-detail': { resource: 'expenses', action: 'view', write: false },
  'expenses-create': { resource: 'expenses', action: 'edit', write: true },
  'expenses-update': { resource: 'expenses', action: 'edit', write: true },
  'expenses-delete': { resource: 'expenses', action: 'edit', write: true },
  'expenses-confirm': { resource: 'expenses', action: 'confirm', write: true },
  'claims-page': { resource: 'expenses', action: 'view', write: false },
  'claims-detail': { resource: 'expenses', action: 'view', write: false },
  'claims-create': { resource: 'expenses', action: 'edit', write: true },
  'claims-update': { resource: 'expenses', action: 'edit', write: true },
  'claims-cancel': { resource: 'expenses', action: 'edit', write: true },
  'claims-submit': { resource: 'expenses', action: 'edit', write: true },
  'claims-confirm': { resource: 'expenses', action: 'confirm', write: true },
  'project-requests-page': { resource: 'expenses', action: 'view', write: false },
  'project-requests-detail': { resource: 'expenses', action: 'view', write: false },
  'project-requests-create': { resource: 'expenses', action: 'edit', write: true },
  'project-requests-update': { resource: 'expenses', action: 'edit', write: true },
  'project-requests-cancel': { resource: 'expenses', action: 'edit', write: true },
  'project-requests-submit': { resource: 'expenses', action: 'edit', write: true },
  'project-requests-confirm': { resource: 'expenses', action: 'confirm', write: true },
  'invoice-approval-request': { resource: 'invoices', action: 'edit', write: true },
  'invoice-approval-bind': { resource: 'invoices', action: 'edit', write: true },
  'invoice-requests-from-altoc': { resource: 'invoices', action: 'edit', write: true },
  'invoice-requests-page': { resource: 'invoices', action: 'view', write: false },
  'invoice-requests-detail': { resource: 'invoices', action: 'view', write: false },
  'invoice-requests-create': { resource: 'invoices', action: 'edit', write: true },
  'invoice-requests-update': { resource: 'invoices', action: 'edit', write: true },
  'invoice-requests-assign-issuance': { resource: 'invoices', action: 'issue', write: true },
  'invoice-requests-issue': { resource: 'invoices', action: 'issue', write: true },
  'invoices-page': { resource: 'invoices', action: 'view', write: false },
  'invoices-detail': { resource: 'invoices', action: 'view', write: false },
  'invoices-update': { resource: 'invoices', action: 'edit', write: true },
  'invoices-void': { resource: 'invoices', action: 'edit', write: true },
  'invoices-red-reverse': { resource: 'invoices', action: 'edit', write: true },
  'receipts-page': { resource: 'receipts', action: 'view', write: false },
  'receipts-detail': { resource: 'receipts', action: 'view', write: false },
  'receipts-create': { resource: 'receipts', action: 'confirm', write: true },
  'receipts-update': { resource: 'receipts', action: 'confirm', write: true },
  'receipts-confirm': { resource: 'receipts', action: 'confirm', write: true },
  'receipts-classify': { resource: 'receipts', action: 'edit', write: true },
  'receipts-delete': { resource: 'receipts', action: 'edit', write: true },
  'reconciliation-page': { resource: 'reconciliation', action: 'view', write: false },
  'reconciliation-create': { resource: 'reconciliation', action: 'confirm', write: true },
  'reconciliation-void': { resource: 'reconciliation', action: 'confirm', write: true },
  'invoice-files-attach': { resource: 'invoices', action: 'edit', write: true },
  'invoice-files-read': { resource: 'invoices', action: 'view', write: false }
} as const
export type FinanceLedgerOperation = keyof typeof financeLedgerOperations
const integer = (value: unknown, fallback = 0, max = 1_000_000) => {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw createError({ statusCode: 400 })
  return Number(value)
}
export function normalizeFinanceLedgerRequest(operation: FinanceLedgerOperation, code: unknown, query: Record<string, unknown>, input: unknown) {
  if (!Object.hasOwn(financeLedgerOperations, operation)) throw createError({ statusCode: 400 })
  const page = operation.endsWith('-page') || operation === 'allocation-candidates'
  if (Object.keys(query).some(k => !page || !['page', 'pageSize', 'search', 'status', ...(financeLedgerOperations[operation].resource === 'settings' ? ['code'] : []), ...(operation === 'expenses-page' ? ['projectOnly'] : [])].includes(k)) || Object.values(query).some(v => typeof v !== 'string' && typeof v !== 'number')) throw createError({ statusCode: 400 })
  if (code !== undefined && !/^[A-Za-z0-9_-]{1,50}$/.test(String(code))) throw createError({ statusCode: 400 })
  const write = financeLedgerOperations[operation].write
  if (write && (!input || typeof input !== 'object' || Array.isArray(input))) throw createError({ statusCode: 400 })
  const settings = financeLedgerOperations[operation].resource === 'settings'
  const payload = write ? input as Record<string, unknown> : query.projectOnly === 'true' && operation === 'expenses-page' ? { projectOnly: true } : {}
  if (query.projectOnly !== undefined && query.projectOnly !== 'true') throw createError({ statusCode: 400 })
  if (Object.keys(payload).some(k => /^(actor|tenant|deployment|current_user|approved|confirmedBy|reconciledBy|sourceApp|row_version)/.test(k) || (k === 'status' && !settings)) || Object.entries(payload).some(([k, v]) => k === 'requiredDimensions' && settings ? !Array.isArray(v) || v.length > 10 || v.some(x => typeof x !== 'string') : k === 'items' ? !Array.isArray(v) || v.length < 1 || v.length > 100 || v.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !(operation === 'reconciliation-allocate-batch' ? ['contractCode', 'billingScheduleCode', 'scheduleVersion', 'amount'] : ['description', 'amount', 'occurredAt', 'expenseTypeId', 'subjectId']).includes(key))) : v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400 })
  return { code: String(code || query.code || ''), page: page ? integer(query.page, 1) : 0, pageSize: page ? integer(query.pageSize, 20, 100) : 0, search: String(query.search || ''), status: String(query.status || ''), accountCode: '', startDate: '', endDate: '', payload }
}
export async function authorizeFinanceLedger(event: H3Event, operation: FinanceLedgerOperation, finance: ReturnType<typeof normalizeFinanceLedgerRequest>) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const spec = financeLedgerOperations[operation]
  const required = operation === 'invoice-files-attach' && finance.payload.attachmentPurpose === 'issuance' ? { ...spec, action: 'issue' as const } : spec
  const key = required.write ? getHeader(event, 'idempotency-key') : undefined
  if (required.write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: required.resource, action: required.action })
  if (scoped.uid !== user.uid || scoped.appCode !== 'finance' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const access = resolveFinanceResponsibilityAccessFromGrants(scoped.grants, required.resource, required.action, scoped.actionPolicy)
  if (access === 'none' || (required.resource === 'settings' && access !== 'all')) throw createError({ statusCode: 403 })
  if (finance.payload.responsibleUid) {
    const uid = String(finance.payload.responsibleUid)
    const statuses = await fetchDirectoryActiveStatuses(event, [uid])
    if (!statuses.some(s => s.uid === uid && s.active)) throw createError({ statusCode: 400, message: '责任人必须是有效成员' })
  }
  const batch = ['historical-finance-page', 'historical-finance-preview', 'historical-finance-activate', 'historical-finance-history-page', 'allocation-candidates', 'allocation-batches-page', 'allocation-batches-detail', 'reconciliation-allocate-batch', 'allocation-batches-reverse', 'receivable-adjustments-page', 'receivable-adjustments-detail', 'receivable-adjustments-create', 'receivable-adjustments-confirm', 'receivable-adjustments-reverse'].includes(operation) ? 'b5b' : required.resource === 'settings' || operation.startsWith('payment-requests-') ? '13b' : ['expenses-', 'claims-', 'project-requests-'].some(prefix => operation.startsWith(prefix)) ? '13a' : operation.startsWith('invoice-approval-') || operation === 'invoice-requests-from-altoc' ? '11b' : '11a'
  const op = `finance.${batch}-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: required.resource, action: required.action, operation, objectId: finance.code, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: access === 'all' ? 'all' : 'self', departmentCodes: [] } }
  return { op, finance, authorization, key }
}
export async function callFinanceLedger(event: H3Event, operation: FinanceLedgerOperation, finance: ReturnType<typeof normalizeFinanceLedgerRequest>) {
  const { op, authorization, key } = await authorizeFinanceLedger(event, operation, finance)
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { finance, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data || !Object.hasOwn(result.data, 'data')) throw createError({ statusCode: 503 })
  return result.data
}
export async function enterpriseFinanceLedger(event: H3Event, operation: FinanceLedgerOperation) {
  const finance = normalizeFinanceLedgerRequest(operation, getRouterParam(event, 'code'), getQuery(event), financeLedgerOperations[operation].write ? await readBody(event) : {})
  return await callFinanceLedger(event, operation, finance)
}
