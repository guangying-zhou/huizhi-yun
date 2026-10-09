import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { renewalFields, renewalOperations, renewalRowFields, type RenewalOperation } from '../../shared/altoc-renewals'
import { buildAPFPermit } from './enterpriseAPF'

export function normalizeRenewalPayload(op: RenewalOperation, raw: Record<string, unknown>) {
  const page = op === 'renewals-page'
  const create = op === 'renewals-create'
  const fields = page ? ['page', 'pageSize', 'search'] : op === 'renewals-view' ? [] : [...renewalFields, ...(create ? [] : ['expectedVersion'])]
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查输入字段' })
  if (page) {
    raw = { page: 1, pageSize: 20, ...raw }
    for (const key of ['page', 'pageSize']) {
      const n = Number(raw[key])
      if (!Number.isSafeInteger(n) || n < 1 || n > (key === 'pageSize' ? 100 : 1000000)) throw createError({ statusCode: 400, message: '分页参数无效' })
      raw[key] = n
    }
  } else if (op === 'renewals-update' && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1 || Object.keys(raw).length < 2)) throw createError({ statusCode: 400, message: '请刷新资料版本后重试' })
  if (create && (!String(raw.name || '').trim() || !String(raw.owner_uid || '').trim() || !/^[1-9]\d{0,15}$/.test(String(raw.customer_id)))) throw createError({ statusCode: 400, message: '名称、客户和负责人为必填项' })
  return raw
}
const pick = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]]))
export async function enterpriseAltocRenewals(event: H3Event, operation: RenewalOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!renewalOperations.includes(operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const page = operation.endsWith('-page')
  const read = page || operation === 'renewals-view'
  const create = operation === 'renewals-create'
  const id = getRouterParam(event, 'renewalId') || ''
  if (page || create ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? { ...getQuery(event) } : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const payload = normalizeRenewalPayload(operation, raw)
  const key = getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16d-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'renewal_opportunity', read ? undefined : 'edit'), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, read ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503 })
  if (!read) {
    if (!/^[1-9]\d{0,15}$/.test(String(result.data.id))) throw createError({ statusCode: 503 })
    return { code: 0, data: { id: result.data.id } }
  }
  if (page) {
    if (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)) throw createError({ statusCode: 503 })
    return { code: 0, data: { items: result.data.items.map(row => pick(row, renewalRowFields)), total: result.data.total } }
  }
  if (String(result.data.id) !== id) throw createError({ statusCode: 503 })
  return { code: 0, data: pick(result.data, renewalRowFields) }
}
