import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { receivableOperations, receivableFilters, receivableRowFields, type ReceivableOperation } from '../../shared/altoc-receivables'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { buildAPFPermit } from './enterpriseAPF'

export function normalizeReceivablePayload(operation: ReceivableOperation, raw: Record<string, unknown>) {
  const read = receivableOperations[operation][0] === 'view'
  const page = read && operation !== 'receivables-detail'
  const allowed = page ? ['page', 'pageSize', ...receivableFilters] : read ? ['page', 'pageSize'] : ['expectedVersion', ...(operation === 'receivables-set-collection-owner' ? ['collection_responsible_uid', 'collection_due_at'] : operation === 'receivables-set-due-date' ? ['due_date'] : ['result', 'promised_payment_date', 'promised_amount', 'next_followup_at'])]
  if (Object.keys(raw).some(k => !allowed.includes(k)) || Object.values(raw).some(v => v !== null && !['number', 'string'].includes(typeof v))) throw createError({ statusCode: 400 })
  const payload = { ...raw }
  if (read) {
    for (const k of ['page', 'pageSize']) {
      const n = Number(raw[k] ?? (k === 'page' ? 1 : 20))
      if (!Number.isSafeInteger(n) || n < 1 || n > (k === 'page' ? 1000000 : 100)) throw createError({ statusCode: 400 })
      payload[k] = n
    }
  }
  if (!read && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)) throw createError({ statusCode: 400, message: '请刷新应收资料后重试' })
  return payload
}
export async function enterpriseAltocReceivables(event: H3Event, operation: ReceivableOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!Object.hasOwn(receivableOperations, operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const [action] = receivableOperations[operation]
  const read = action === 'view'
  const page = read && operation !== 'receivables-detail'
  const id = getRouterParam(event, 'planId') || ''
  if (page ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? getQuery(event) : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const payload = normalizeReceivablePayload(operation, raw)
  const key = getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.b5a-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'receivable', read ? undefined : action), operation }
  if (payload.legalEntityCode) {
    const bank = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'finance', { resourceCode: 'bank_accounts', action: 'view' })
    if (bank.uid !== user.uid || bank.appCode !== 'finance' || bank.bundleVersion !== authorization.bundleVersion || bank.bundleHash !== authorization.bundleHash || bank.policyRevision !== authorization.policyRevision || Number(bank.authorizationExpiresAt || 0) <= Date.now()) throw createError({ statusCode: 503 })
    if (!evaluateFoundationScopedAuthorization({ grants: bank.grants, required: { appCode: 'finance', resourceCode: 'bank_accounts', action: 'view' }, policyOf: () => bank.actionPolicy }).allowed) throw createError({ statusCode: 403 })
    authorization.expiresAt = Math.min(authorization.expiresAt, bank.authorizationExpiresAt!)
    payload.legalEntityRead = true
  }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, read ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data || typeof result.data !== 'object') throw createError({ statusCode: 503 })
  const pick = (row: Record<string, unknown>) => Object.fromEntries(receivableRowFields.filter(k => k in row).map(k => [k, row[k]]))
  const d = result.data
  if (id && String(d.id) !== id) throw createError({ statusCode: 503 })
  if (!read) {
    if (!Number.isSafeInteger(d.row_version) || Number(d.row_version) < 1) throw createError({ statusCode: 503 })
    return { code: 0, data: pick(d) }
  }
  if (!page) return { code: 0, data: { ...pick(d), query_date: d.query_date, followup_page: d.followup_page, followup_page_size: d.followup_page_size, followup_total: d.followup_total, followups: Array.isArray(d.followups) ? d.followups.map(row => Object.fromEntries(['code', 'event_type', 'before_json', 'after_json', 'result', 'promised_payment_date', 'promised_amount', 'next_followup_at', 'actor_uid', 'created_at'].filter(k => k in row).map(k => [k, row[k]]))) : [] } }
  if (!Array.isArray(d.items) || !Array.isArray(d.totals) || !Number.isSafeInteger(d.total) || d.page !== payload.page || d.pageSize !== payload.pageSize) throw createError({ statusCode: 503 })
  return { code: 0, data: { items: d.items.map(pick), total: d.total, page: d.page, pageSize: d.pageSize, totals: d.totals.map(row => Object.fromEntries(['currency_code', 'aging_bucket', 'item_count', 'amount', 'received_amount', 'outstanding_amount'].filter(k => k in row).map(k => [k, row[k]]))), query_date: d.query_date, date_basis: d.date_basis, historical_not_ready_count: d.historical_not_ready_count, collection_installed: d.collection_installed } }
}
