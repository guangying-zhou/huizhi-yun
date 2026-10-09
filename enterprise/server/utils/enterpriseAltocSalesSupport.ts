import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { buildAPFPermit } from './enterpriseAPF'

export const supportOperations = ['lead-activities-list', 'opportunity-activities-list', 'opportunity-contact-roles-list', 'opportunity-contact-roles-create', 'opportunity-contact-roles-update', 'opportunity-contact-roles-delete', 'opportunity-stages-list', 'opportunity-stage-history-list', 'lead-documents-list', 'lead-documents-create', 'lead-documents-delete', 'opportunity-documents-list', 'opportunity-documents-create', 'opportunity-documents-delete'] as const
export type SalesSupportOperation = typeof supportOperations[number]
export function normalizeSalesSupport(op: SalesSupportOperation, raw: Record<string, unknown>) {
  const list = op.endsWith('-list')
  const fields = list ? ['page', 'pageSize'] : ['expectedVersion']
  if (op === 'opportunity-stages-list') fields.push('purpose')
  if (op.endsWith('-delete') || op.endsWith('-update')) fields.push('childId')
  if (op.includes('contact-roles') && !list && !op.endsWith('-delete')) fields.push('contactId', 'role', 'influence_level', 'attitude', 'is_primary', 'remark')
  if (op.endsWith('documents-create')) fields.push('document_uuid', 'link_type')
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查输入字段' })
  if (list) {
    raw = { page: 1, pageSize: 20, ...raw }
    for (const k of ['page', 'pageSize']) {
      if (!['string', 'number'].includes(typeof raw[k])) throw createError({ statusCode: 400 })
      const n = Number(raw[k])
      if (!Number.isSafeInteger(n) || n < 1 || n > (k === 'page' ? 1_000_000 : 100)) throw createError({ statusCode: 400 })
      raw[k] = n
    }
  } else if (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1) throw createError({ statusCode: 400, message: '资料版本无效，请刷新后重试' })
  return raw
}
export async function enterpriseAltocSalesSupport(event: H3Event, operation: SalesSupportOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!supportOperations.includes(operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const list = operation.endsWith('-list')
  const config = operation === 'opportunity-stages-list'
  const resource = operation.startsWith('lead-') ? 'lead' : 'opportunity'
  const id = config ? '' : getRouterParam(event, `${resource}Id`) || ''
  if (!config && (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) throw createError({ statusCode: 400 })
  if (!list && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = list ? { ...getQuery(event) } : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const childId = getRouterParam(event, 'childId')
  if (childId) {
    if (!/^[1-9]\d{0,15}$/.test(childId) || !Number.isSafeInteger(Number(childId)) || Object.hasOwn(raw, 'childId')) throw createError({ statusCode: 400 })
    raw.childId = childId
  }
  const payload = normalizeSalesSupport(operation, raw)
  if (config && !['lead-convert', 'opportunity-view'].includes(String(payload.purpose))) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'idempotency-key')
  if (!list && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf07b-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const convert = config && payload.purpose === 'lead-convert'
  const authorization = { ...await buildAPFPermit(event, 'altoc', list ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, convert ? 'lead' : resource, convert ? 'convert' : list ? undefined : 'edit'), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: { items?: Record<string, unknown>[], total?: number, childId?: string, parentVersion?: string } }>(event, op, { sales: { id, payload }, authorization }, list ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data || (list && (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)))) throw createError({ statusCode: 503 })
  if (!list && (!/^[1-9]\d{0,15}$/.test(String(result.data.childId)) || !/^[1-9]\d{0,9}$/.test(String(result.data.parentVersion)))) throw createError({ statusCode: 503 })
  return { code: 0, data: result.data }
}
