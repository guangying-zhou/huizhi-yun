import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { reportedUserAgent, trustedClientAddress } from '@hzy/foundation/server/utils/trustedClientAddress'

export const financeOperations = {
  'accounts-list': { resource: 'bank_accounts', action: 'view' },
  'accounts-view': { resource: 'bank_accounts', action: 'view' },
  'accounts-create': { resource: 'bank_accounts', action: 'admin' },
  'accounts-update': { resource: 'bank_accounts', action: 'admin' },
  'balances-list': { resource: 'bank_accounts', action: 'view' },
  'legal-entities-list': { resource: 'legal_entities', action: 'view' },
  'legal-entities-view': { resource: 'legal_entities', action: 'view' },
  'legal-entities-create': { resource: 'legal_entities', action: 'edit' },
  'legal-entities-update': { resource: 'legal_entities', action: 'edit' },
  'parameters-list': { resource: 'settings', action: 'admin' },
  'parameters-view': { resource: 'settings', action: 'admin' },
  'parameters-create': { resource: 'settings', action: 'admin' },
  'parameters-update': { resource: 'settings', action: 'admin' },
  'parameters-history': { resource: 'settings', action: 'admin' }
} as const
export type FinanceOperation = keyof typeof financeOperations
export function normalizeFinanceRequest(operation: FinanceOperation, query: Record<string, unknown>, code: string | undefined, payload: unknown) {
  if (!Object.hasOwn(financeOperations, operation)) throw createError({ statusCode: 400 })
  const list = operation.endsWith('-list') || operation.endsWith('-history')
  const write = operation.endsWith('-create') || operation.endsWith('-update')
  const allowed = list ? ['page', 'pageSize', 'search', 'status'] : []
  if (operation === 'accounts-list') allowed.push('legalEntityCode', 'accountType', 'complete', 'asOfDate', 'staleBefore', 'balanceState', 'currencyCode')
  if (operation === 'balances-list') allowed.push('legalEntityCode')
  if (operation === 'balances-list') allowed.push('accountCode', 'startDate', 'endDate')
  if (Object.keys(query).some(key => !allowed.includes(key)) || Object.values(query).some(value => typeof value !== 'string' && typeof value !== 'number')) throw createError({ statusCode: 400 })
  const integer = (value: unknown, fallback: number, max: number) => {
    const n = value ?? fallback
    if (!/^[1-9]\d*$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) > max) throw createError({ statusCode: 400 })
    return Number(n)
  }
  if (code && !/^[A-Za-z0-9_-]{1,50}$/.test(code)) throw createError({ statusCode: 400 })
  if (write && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw createError({ statusCode: 400 })
  const body = write ? payload as Record<string, unknown> : {}
  const account = operation.startsWith('accounts-')
  const fields = account ? ['accountName', 'bankName', 'accountNoMasked', 'accountNoSecretRef', 'accountType', 'currencyCode', 'ownerDeptCode', 'status', 'shortName', 'bankBranchCode', 'legalEntityCode', 'sortNo', 'accountSubtype'] : operation.startsWith('legal-entities-') ? ['name', 'shortName', 'unifiedSocialCreditCode', 'entityType', 'registeredAddress', 'invoiceTitle', 'invoiceTaxNo', 'status', 'sortNo', 'remark'] : ['name', 'effectiveFrom', 'effectiveTo', 'baseSalary', 'welfareCostRate', 'managementAllocationRate', 'resourceAllocationCost', 'currencyCode', 'status', 'remark']
  if (operation.endsWith('-update')) fields.push('expectedVersion')
  if (Object.keys(body).some(key => !fields.includes(key)) || Object.values(body).some(value => value !== null && typeof value !== 'string' && typeof value !== 'number')) throw createError({ statusCode: 400 })
  if (operation.endsWith('-update') && (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) throw createError({ statusCode: 400 })
  for (const field of ['baseSalary', 'welfareCostRate', 'managementAllocationRate', 'resourceAllocationCost']) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'string') throw createError({ statusCode: 400 })
  }
  if (query.legalEntityCode !== undefined && !/^[A-Za-z0-9_-]{1,50}$/.test(String(query.legalEntityCode))) throw createError({ statusCode: 400 })
  if (query.accountType !== undefined && !['bank', 'third_party', 'cash', 'internal'].includes(String(query.accountType))) throw createError({ statusCode: 400 })
  if (query.complete !== undefined && !['true', 'false'].includes(String(query.complete))) throw createError({ statusCode: 400 })
  if (query.complete === 'true' && integer(query.page, 1, 1_000_000) !== 1) throw createError({ statusCode: 400 })
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  if ((query.asOfDate && !date(query.asOfDate)) || (query.staleBefore && (!date(query.staleBefore) || !query.asOfDate || String(query.staleBefore) > String(query.asOfDate))) || (query.balanceState && (!query.asOfDate || !['known', 'missing', 'stale', 'conflict'].includes(String(query.balanceState)))) || (query.currencyCode && (!query.asOfDate || !/^[A-Z]{3}$/.test(String(query.currencyCode)))) || (query.balanceState === 'stale' && !query.staleBefore) || (query.asOfDate && query.complete === 'true')) throw createError({ statusCode: 400 })
  return { ...Object.fromEntries(['asOfDate', 'staleBefore', 'balanceState', 'currencyCode'].filter(key => query[key]).map(key => [key, String(query[key])])), ...(query.legalEntityCode ? { legalEntityCode: String(query.legalEntityCode) } : {}), ...(query.accountType ? { accountType: String(query.accountType) } : {}), ...(query.complete === 'true' ? { complete: true } : {}), code: code || '', page: list ? integer(query.page, 1, 1_000_000) : 0, pageSize: list ? integer(query.pageSize, 20, 100) : 0, search: String(query.search || ''), status: String(query.status || ''), accountCode: String(query.accountCode || ''), startDate: String(query.startDate || ''), endDate: String(query.endDate || ''), payload: body }
}

export async function enterpriseFinance(event: H3Event, operation: FinanceOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const write = operation.endsWith('-create') || operation.endsWith('-update')
  const finance = normalizeFinanceRequest(operation, getQuery(event), getRouterParam(event, 'code'), write ? await readBody(event) : {})
  const key = write ? getHeader(event, 'idempotency-key') : undefined
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: 'Idempotency-Key is required.' })
  const required = financeOperations[operation]
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: required.resource, action: required.action })
  if (scoped.uid !== user.uid || scoped.appCode !== 'finance' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  if (!evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: required.resource, action: required.action }, policyOf: () => scoped.actionPolicy }).allowed) throw createError({ statusCode: 403 })
  let countExpiry = Infinity
  if (operation === 'legal-entities-list' || operation === 'legal-entities-view') {
    const accounts = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'bank_accounts', action: 'view' })
    if (accounts.uid !== user.uid || accounts.appCode !== 'finance' || accounts.bundleVersion !== scoped.bundleVersion || accounts.bundleHash !== scoped.bundleHash || accounts.policyRevision !== scoped.policyRevision || Number(accounts.authorizationExpiresAt || 0) <= Date.now()) throw createError({ statusCode: 503 })
    if (evaluateFoundationScopedAuthorization({ grants: accounts.grants, required: { appCode: 'finance', resourceCode: 'bank_accounts', action: 'view' }, policyOf: () => accounts.actionPolicy }).allowed) {
      Object.assign(finance, { accountCountAllowed: true })
      countExpiry = accounts.authorizationExpiresAt!
    }
  }
  const op = `finance.wp3-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0, countExpiry)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: required.resource, action: required.action, operation, objectId: finance.code, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'all', departmentCodes: [] } }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { finance, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data || !Object.hasOwn(result.data, 'data')) throw createError({ statusCode: 503 })
  if ((operation === 'legal-entities-list' || operation === 'legal-entities-view') && !('accountCountAllowed' in finance)) {
    // Defense in depth for a candidate running an older Runtime.
    const omitCount = (row: unknown) => Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => key !== 'account_count'))
    return { ...result.data, data: Array.isArray(result.data.data) ? result.data.data.map(omitCount) : omitCount(result.data.data) }
  }
  return result.data
}

// Showing a full account number. The browser sends only a reason; the client
// address is taken from the Host's own request context and travels inside the
// signed command. The response is never cached, stored or logged here.
export function normalizeAccountNoReveal(code: string | undefined, query: Record<string, unknown>, body: unknown) {
  if (!code || !/^[A-Za-z0-9_-]{1,50}$/.test(code) || Object.keys(query).length) throw createError({ statusCode: 400 })
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 })
  const raw = body as Record<string, unknown>
  const reason = raw.reason
  // eslint-disable-next-line no-control-regex
  if (Object.keys(raw).some(key => key !== 'reason') || typeof reason !== 'string' || reason !== reason.trim() || [...reason].length < 4 || [...reason].length > 200 || /[\u0000-\u001f\u007f]/.test(reason)) throw createError({ statusCode: 400 })
  return { code, reason }
}

export async function enterpriseFinanceRevealAccountNo(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Pragma', 'no-cache')
  const user = await requireEnterpriseUser(event)
  const { code, reason } = normalizeAccountNoReveal(getRouterParam(event, 'code'), getQuery(event), await readBody(event))
  const clientIp = trustedClientAddress(event)
  if (!clientIp) throw createError({ statusCode: 503 })
  // Explicit action: under the platform default neither admin nor edit implies it.
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'bank_accounts', action: 'reveal-account-no' })
  if (scoped.uid !== user.uid || scoped.appCode !== 'finance' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  if (!evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: 'bank_accounts', action: 'reveal-account-no' }, policyOf: () => scoped.actionPolicy }).allowed) throw createError({ statusCode: 403 })
  const op = 'finance.wp3-accounts-reveal-account-no' as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const finance = { code, page: 0, pageSize: 0, search: '', status: '', accountCode: '', startDate: '', endDate: '', payload: { reason, clientIp, userAgent: reportedUserAgent(event) } }
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'bank_accounts', action: 'reveal-account-no', operation: 'accounts-reveal-account-no', objectId: code, allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'all', departmentCodes: [] } }
  const result = await callEnterpriseRuntime<{ code: number, data: { data?: { code?: unknown, accountNo?: unknown, revealedAt?: unknown } } }>(event, op, { finance, authorization })
  const data = result.data?.data
  if (result.code !== 0 || !data || data.code !== code || typeof data.accountNo !== 'string' || !data.accountNo || typeof data.revealedAt !== 'string') throw createError({ statusCode: 503 })
  return { data: { code, accountNo: data.accountNo, revealedAt: data.revealedAt } }
}

// Balance register: every registration is kept; the day's shown value is the last one.
export function normalizeBalanceEntryRequest(write: boolean, code: string | undefined, query: Record<string, unknown>, body: unknown) {
  if (!code || !/^[A-Za-z0-9_-]{1,50}$/.test(code)) throw createError({ statusCode: 400 })
  const integer = (value: unknown, fallback: number, max: number) => {
    const n = value ?? fallback
    if (!/^[1-9]\d*$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) > max) throw createError({ statusCode: 400 })
    return Number(n)
  }
  const date = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError({ statusCode: 400 })
    return value
  }
  const empty = { code: '', page: 0, pageSize: 0, search: '', status: '', accountCode: code, startDate: '', endDate: '', payload: {} as Record<string, unknown> }
  if (!write) {
    if (Object.keys(query).some(key => !['date', 'page', 'pageSize'].includes(key))) throw createError({ statusCode: 400 })
    return { ...empty, startDate: date(query.date), page: integer(query.page, 1, 1_000_000), pageSize: integer(query.pageSize, 50, 100) }
  }
  if (Object.keys(query).length || !body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400 })
  const raw = body as Record<string, unknown>
  if (Object.keys(raw).some(key => !['balanceDate', 'balanceAmount', 'note'].includes(key))) throw createError({ statusCode: 400 })
  // Amounts travel as text so no precision is lost; a loan account is negative.
  if (typeof raw.balanceAmount !== 'string' || !/^-?(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(raw.balanceAmount)) throw createError({ statusCode: 400 })
  const note = raw.note === undefined || raw.note === '' ? null : raw.note
  if (note !== null && (typeof note !== 'string' || note !== note.trim() || [...note].length > 500)) throw createError({ statusCode: 400 })
  return { ...empty, payload: { balanceDate: date(raw.balanceDate), balanceAmount: raw.balanceAmount, note } }
}

async function balanceEntry(event: H3Event, write: boolean) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const finance = normalizeBalanceEntryRequest(write, getRouterParam(event, 'code'), getQuery(event), write ? await readBody(event) : {})
  const key = write ? getHeader(event, 'idempotency-key') : undefined
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400, message: 'Idempotency-Key is required.' })
  // Registering needs bank_accounts:edit; reading the day's entries needs view.
  const scoped = write
    ? await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'bank_accounts', action: 'edit' })
    : await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'bank_accounts', action: 'view' })
  if (scoped.uid !== user.uid || scoped.appCode !== 'finance' || !scoped.bundleVersion || !scoped.bundleHash || !Number.isSafeInteger(scoped.policyRevision)) throw createError({ statusCode: 503 })
  const allowed = write
    ? evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: 'bank_accounts', action: 'edit' }, policyOf: () => scoped.actionPolicy }).allowed
    : evaluateFoundationScopedAuthorization({ grants: scoped.grants, required: { appCode: 'finance', resourceCode: 'bank_accounts', action: 'view' }, policyOf: () => scoped.actionPolicy }).allowed
  if (!allowed) throw createError({ statusCode: 403 })
  const operation = write ? 'balance-entries-create' : 'balance-entries-list'
  const op = `finance.w3-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const expiresAt = Math.min(enterpriseRuntimePermitExpiresAt(), scoped.authorizationExpiresAt ?? 0)
  if (expiresAt <= Date.now()) throw createError({ statusCode: 503 })
  const authorization = { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'bank_accounts', action: write ? 'edit' : 'view', operation, objectId: '', allowed: true, expiresAt, bundleVersion: scoped.bundleVersion, bundleHash: scoped.bundleHash, policyRevision: scoped.policyRevision, scope: { access: 'all', departmentCodes: [] } }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { finance, authorization }, write ? { idempotencyKey: key } : undefined)
  if (result.code !== 0 || !result.data || !Object.hasOwn(result.data, 'data')) throw createError({ statusCode: 503 })
  return result.data
}
export const enterpriseFinanceBalanceEntries = (event: H3Event) => balanceEntry(event, false)
export const enterpriseFinanceBalanceEntryCreate = (event: H3Event) => balanceEntry(event, true)
