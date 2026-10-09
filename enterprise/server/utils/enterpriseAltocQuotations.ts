import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser, prepareEnterpriseRuntime, callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { altocReadFields, altocQuotationItemFields } from '../../shared/altoc-basic-read'
import { submitAltocApproval } from './enterpriseAltocApproval'
import { buildAPFPermit } from './enterpriseAPF'

export const quotationOperations = ['quotations-create', 'quotations-update', 'quotation-items-replace', 'quotation-versions-list', 'quotation-versions-view', 'quotations-transition'] as const
export type QuotationOperation = typeof quotationOperations[number]
function projectFields(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError({ statusCode: 503 })
  const row = value as Record<string, unknown>
  const selected = Object.fromEntries(fields.filter(key => key in row).map(key => [key, row[key]]))
  if (Object.values(selected).some(v => (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) || (typeof v === 'number' && !Number.isFinite(v)))) throw createError({ statusCode: 503 })
  return selected
}
export function projectQuotationResult(value: Record<string, unknown>, operation: QuotationOperation, id: string, version: number) {
  if (operation === 'quotation-versions-list') {
    if (!Array.isArray(value.data) || value.data.length > 100 || !Number.isSafeInteger(value.total) || Number(value.total) < value.data.length || !Number.isSafeInteger(value.page) || Number(value.page) < 1 || !Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 100) throw createError({ statusCode: 503 })
    const rows = value.data.map((row) => {
      const projected = projectFields(row, ['id', 'version_no', 'snapshot_sha256', 'created_by', 'created_at'])
      if (!Number.isSafeInteger(projected.version_no) || Number(projected.version_no) < 1) throw createError({ statusCode: 503 })
      return projected
    })
    return { data: rows, total: value.total, page: value.page, pageSize: value.pageSize }
  }
  const data = value.data as Record<string, unknown>
  const row = projectFields(data, altocReadFields.quotation)
  if (!/^[1-9]\d{0,15}$/.test(String(row.id)) || !Number.isSafeInteger(Number(row.id)) || (id && String(row.id) !== id) || (operation === 'quotation-versions-view' && row.version_no !== version) || !Array.isArray(data.items) || data.items.length > 1000) throw createError({ statusCode: 503 })
  row.items = data.items.map((item) => {
    const projected = projectFields(item, altocQuotationItemFields)
    if (String(projected.quotation_id) !== String(row.id)) throw createError({ statusCode: 503 })
    return projected
  })
  return { data: row }
}
export async function enterpriseAltocQuotation(event: H3Event, operation: QuotationOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const read = operation.startsWith('quotation-versions-')
  const raw = read ? getQuery(event) : await readBody<Record<string, unknown>>(event)
  if (!quotationOperations.includes(operation) || !raw || typeof raw !== 'object' || Array.isArray(raw) || (!read && Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400 })
  const id = getRouterParam(event, 'quotationId') || ''
  if (operation === 'quotations-create' ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  const integer = (v: unknown, fallback: number, max: number) => {
    const n = v ?? fallback
    if (!/^[1-9]\d*$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) > max) throw createError({ statusCode: 400 })
    return Number(n)
  }
  const key = read ? undefined : getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const allowed = operation === 'quotation-versions-list' ? ['page', 'pageSize'] : operation === 'quotation-versions-view' ? [] : operation === 'quotations-create' ? ['customerId', 'quotation_no', 'valid_until', 'currency_code', 'remark'] : operation === 'quotations-update' ? ['expectedVersion', 'quotation_no', 'valid_until', 'remark'] : operation === 'quotation-items-replace' ? ['expectedVersion', 'items'] : ['expectedVersion', 'action']
  if (Object.keys(raw).some(k => !allowed.includes(k))) throw createError({ statusCode: 400 })
  if (operation === 'quotations-transition' && raw.action === 'submit') return await submitAltocApproval(event, 'quotation', id, raw.expectedVersion)
  const customerId = operation === 'quotations-create' ? String(raw.customerId || '') : ''
  if (customerId && (!/^[1-9]\d{0,15}$/.test(customerId) || !Number.isSafeInteger(Number(customerId)))) throw createError({ statusCode: 400 })
  const payload = Object.fromEntries(Object.entries(raw).filter(([k]) => !['customerId', 'items', 'page', 'pageSize'].includes(k)))
  const items = operation === 'quotation-items-replace' ? raw.items : []
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['item_name', 'specification', 'unit', 'quantity', 'unit_price', 'discount_rate', 'tax_rate'].includes(k)) || ['item_name', 'quantity', 'unit_price', 'discount_rate', 'tax_rate'].some(k => typeof item[k] !== 'string') || ['specification', 'unit'].some(k => item[k] != null && typeof item[k] !== 'string'))) throw createError({ statusCode: 400 })
  const quotation = { id, customerId, page: operation === 'quotation-versions-list' ? integer(raw.page, 1, 1_000_000) : 0, pageSize: operation === 'quotation-versions-list' ? integer(raw.pageSize, 20, 100) : 0, version: operation === 'quotation-versions-view' ? integer(getRouterParam(event, 'version'), 0, 2147483647) : 0, payload, items }
  const input = { id: `${id}|${customerId}|${quotation.version}`, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }
  const op = `altoc.wp4b-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', input, user, 'quotation'), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: { data: unknown } }>(event, op, { quotation, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data || !Object.hasOwn(result.data, 'data')) throw createError({ statusCode: 503 })
  return projectQuotationResult(result.data, operation, id, quotation.version)
}
