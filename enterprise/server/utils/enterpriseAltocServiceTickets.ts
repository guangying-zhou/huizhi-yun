import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { serviceTicketOperations, ticketFields, ticketRowFields, type ServiceTicketOperation } from '../../shared/altoc-service-tickets'
import { buildAPFPermit } from './enterpriseAPF'

export function normalizeServiceTicketPayload(op: ServiceTicketOperation, raw: Record<string, unknown>) {
  const read = op.endsWith('-view') || op.endsWith('-page')
  const create = op === 'service-tickets-create'
  const fields = op.endsWith('-page') ? ['page', 'pageSize', 'search'] : op.endsWith('-view') ? [] : op === 'service-tickets-create' || op === 'service-tickets-update' ? [...ticketFields, ...(create ? ['service_agreement_id'] : ['expectedVersion'])] : op === 'service-ticket-dispatch' ? ['expectedVersion', 'project_code', 'estimated_hours'] : op === 'service-tickets-close' || op === 'service-tickets-reopen' ? ['expectedVersion', 'reason'] : ['expectedVersion']
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查工单字段' })
  if (op.endsWith('-page')) {
    raw = { page: 1, pageSize: 20, ...raw }
    for (const k of ['page', 'pageSize']) {
      const n = Number(raw[k])
      if (!Number.isSafeInteger(n) || n < 1 || n > (k === 'pageSize' ? 100 : 1000000)) throw createError({ statusCode: 400 })
      raw[k] = n
    }
  }
  if (!read && !create && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)) throw createError({ statusCode: 400, message: '请刷新工单后重试' })
  if (create && (!String(raw.title || '').trim() || !/^[1-9]\d{0,15}$/.test(String(raw.service_agreement_id)))) throw createError({ statusCode: 400, message: '工单标题和服务协议为必填项' })
  return raw
}
export async function enterpriseAltocServiceTickets(event: H3Event, operation: ServiceTicketOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!serviceTicketOperations.includes(operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const read = operation.endsWith('-view') || operation.endsWith('-page')
  const create = operation === 'service-tickets-create'
  const id = getRouterParam(event, 'ticketId') || ''
  if (operation === 'service-tickets-page' || create ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? { ...getQuery(event) } : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const payload = normalizeServiceTicketPayload(operation, raw)
  const key = getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16c-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const action = read ? undefined : operation === 'service-tickets-close' ? 'close' : operation === 'service-tickets-reopen' ? 'reopen' : 'edit'
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'service_ticket', action), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, read ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503 })
  const pick = (r: Record<string, unknown>) => Object.fromEntries(ticketRowFields.filter(k => k in r).map(k => [k, r[k]]))
  if (!read) {
    if (!/^[1-9]\d{0,15}$/.test(String(result.data.id)) || !Number.isSafeInteger(Number(result.data.id)) || (!create && String(result.data.id) !== id)) throw createError({ statusCode: 503 })
    return { code: 0, data: { id: result.data.id } }
  }
  if (operation.endsWith('-page')) {
    if (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)) throw createError({ statusCode: 503 })
    return { code: 0, data: { items: result.data.items.map(pick), total: result.data.total } }
  }
  if (String(result.data.id) !== id) throw createError({ statusCode: 503 })
  return { code: 0, data: pick(result.data) }
}
