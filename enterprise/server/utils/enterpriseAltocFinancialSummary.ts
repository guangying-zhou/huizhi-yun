import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { financeProjectAccountingScopeQuery, resolveFinanceResponsibilityAccessFromGrants } from '../../../finance/server/utils/financeScopedAuthorization'
import { buildAPFPermit } from './enterpriseAPF'

export type ServiceSummaryOperation = 'customer-service-finance-summary' | 'service-cost-summary-view'
export async function enterpriseAltocFinancialSummary(event: H3Event, operation: ServiceSummaryOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const customer = operation === 'customer-service-finance-summary'
  const id = getRouterParam(event, customer ? 'customerId' : 'agreementId') || ''
  const query = getQuery(event)
  if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || Object.keys(query).some(k => customer || k !== 'periodMonth') || (!customer && (typeof query.periodMonth !== 'string' || !/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(query.periodMonth)))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16g-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  const authorization = { ...await buildAPFPermit(event, 'altoc', 'view', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, customer ? undefined : 'contract'), operation }
  let expiresAt = Math.min(authorization.expiresAt, enterpriseRuntimePermitExpiresAt())
  const valid = (s: Awaited<ReturnType<typeof loadScopedAuthorizationFromConsoleRuntime>>) => {
    if (s.uid !== user.uid || s.appCode !== 'finance' || s.bundleVersion !== authorization.bundleVersion || s.bundleHash !== authorization.bundleHash || s.policyRevision !== authorization.policyRevision || (s.authorizationExpiresAt ?? 0) <= Date.now()) throw createError({ statusCode: 503 })
    expiresAt = Math.min(expiresAt, s.authorizationExpiresAt ?? 0)
  }
  const disclosure = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, expiresAt: 0, invoices: 'none', receipts: 'none', reconciliation: 'none', costAccess: 'none', projectCodes: [] as string[] }
  if (customer) {
    for (const resourceCode of ['invoices', 'receipts', 'reconciliation'] as const) {
      const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode, action: 'view' })
      valid(scoped)
      const access = resolveFinanceResponsibilityAccessFromGrants(scoped.grants, resourceCode, 'view', scoped.actionPolicy)
      disclosure[resourceCode] = access === 'relation' ? 'self' : access
    }
  } else {
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'project_accounting', action: 'view' })
    valid(scoped)
    const projection = financeProjectAccountingScopeQuery(scoped, 'view')
    disclosure.costAccess = String(projection.current_user_project_finance_access)
    disclosure.projectCodes = disclosure.costAccess === 'projects' ? String(projection.current_user_project_finance_project_codes).split(',').sort() : []
  }
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  disclosure.expiresAt = expiresAt
  authorization.expiresAt = expiresAt
  const payload = { financeAuthorization: JSON.stringify(disclosure), ...(!customer ? { periodMonth: query.periodMonth } : {}) }
  await prepareEnterpriseRuntime(event, op)
  const response = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization })
  if (response.code !== 0 || !response.data) throw createError({ statusCode: 503 })
  return { code: 0, data: serviceSummaryPublicResponse(operation, response.data) }
}
export function serviceSummaryPublicResponse(operation: ServiceSummaryOperation, source: Record<string, unknown>) {
  if (source.access === 'denied') return { access: 'denied' }
  if (source.access !== 'allowed') throw createError({ statusCode: 503 })
  if (operation === 'customer-service-finance-summary') {
    const out: Record<string, unknown> = { access: 'allowed' }
    for (const key of ['invoices', 'receipts', 'reconciliation']) {
      const section = source[key] as Record<string, unknown> | undefined
      if (!section || !['allowed', 'denied'].includes(String(section.access))) throw createError({ statusCode: 503 })
      if (section.access === 'denied') out[key] = { access: 'denied' }
      else {
        if (!Array.isArray(section.currencyTotals)) throw createError({ statusCode: 503 })
        out[key] = { access: 'allowed', currencyTotals: section.currencyTotals.map((r) => {
          if (!r || typeof r !== 'object' || typeof r.currency !== 'string' || typeof r.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(r.amount) || !Number.isSafeInteger(r.count) || r.count < 0) throw createError({ statusCode: 503 })
          return { currency: r.currency, amount: r.amount, count: r.count }
        }) }
      }
    }
    return out
  }
  if (!Array.isArray(source.items)) throw createError({ statusCode: 503 })
  const fields = ['projectCode', 'periodMonth', 'currency', 'readiness', 'missingInputs', 'laborCostAmount', 'directExpenseAmount', 'otherCostAmount', 'grossProfitAmount', 'grossMarginRate']
  return { access: 'allowed', items: source.items.map((raw) => {
    if (!raw || typeof raw !== 'object' || !['ready', 'not_ready'].includes(String(raw.readiness))) throw createError({ statusCode: 503 })
    return Object.fromEntries(fields.filter(k => k in raw).map(k => [k, raw.readiness !== 'ready' && (k.endsWith('Amount') || k === 'grossMarginRate') ? null : raw[k]]))
  }) }
}
