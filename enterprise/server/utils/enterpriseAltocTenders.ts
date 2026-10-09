import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { tenderFields, tenderOperations, tenderRowFields, type TenderOperation } from '../../shared/altoc-tenders'
import { buildAPFPermit } from './enterpriseAPF'

export function normalizeTenderPayload(op: TenderOperation, raw: Record<string, unknown>) {
  const page = op.endsWith('-page')
  const create = op === 'tenders-create' || op === 'tender-agencies-create'
  let fields: string[] = []
  if (page) fields = ['page', 'pageSize', 'search']
  else if (op === 'tenders-view') fields = []
  else if (op.startsWith('tenders-')) fields = tenderFields
  else if (op === 'tender-agencies-create') fields = ['name', 'agency_type', 'address', 'contact_name', 'contact_phone', 'contact_email']
  else if (op === 'tender-members-add') fields = ['user_id', 'role']
  else if (op === 'tender-members-remove') fields = ['childId']
  else fields = ['name', 'due_date', 'status', 'assignee_user_id', 'sort_no', 'remark', ...(op.endsWith('-update') ? ['childId'] : [])]
  if (!page && !create && op !== 'tenders-view') fields = [...fields, 'expectedVersion']
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查输入字段' })
  if (page) {
    raw = { page: 1, pageSize: 20, ...raw }
    for (const key of ['page', 'pageSize']) {
      const n = Number(raw[key])
      if (!Number.isSafeInteger(n) || n < 1 || n > (key === 'pageSize' ? 100 : 1000000)) throw createError({ statusCode: 400, message: '分页参数无效' })
      raw[key] = n
    }
  } else if (!create && op !== 'tenders-view' && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)) throw createError({ statusCode: 400, message: '请刷新资料版本后重试' })
  if (create && (!String(raw.name || '').trim() || (op === 'tenders-create' && !String(raw.owner_uid || '').trim()))) throw createError({ statusCode: 400, message: '名称和负责人为必填项' })
  return raw
}
const pick = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]]))
const agencyFields = ['id', 'row_version', 'name', 'agency_type', 'address', 'contact_name', 'contact_phone', 'contact_email']
export async function enterpriseAltocTenders(event: H3Event, operation: TenderOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!tenderOperations.includes(operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const page = operation.endsWith('-page')
  const read = page || operation === 'tenders-view'
  const create = operation === 'tenders-create' || operation === 'tender-agencies-create'
  const id = getRouterParam(event, 'tenderId') || ''
  if (page || create ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? { ...getQuery(event) } : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const childId = getRouterParam(event, 'childId')
  if (childId) {
    if (!/^[1-9]\d{0,15}$/.test(childId) || Object.hasOwn(raw, 'childId')) throw createError({ statusCode: 400 })
    raw.childId = childId
  }
  const payload = normalizeTenderPayload(operation, raw)
  const key = getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16a-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'opportunity', read ? undefined : 'edit'), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, read ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503 })
  if (!read) {
    if (!/^[1-9]\d{0,15}$/.test(String(result.data.id))) throw createError({ statusCode: 503 })
    return { code: 0, data: { id: result.data.id } }
  }
  if (page) {
    if (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)) throw createError({ statusCode: 503 })
    return { code: 0, data: { items: result.data.items.map(row => pick(row, operation.startsWith('tender-agencies') ? agencyFields : tenderRowFields)), total: result.data.total } }
  }
  if (String(result.data.id) !== id) throw createError({ statusCode: 503 })
  return { code: 0, data: { ...pick(result.data, tenderRowFields), members: ((result.data.members || []) as Record<string, unknown>[]).map(row => pick(row, ['id', 'user_id', 'role', 'row_version'])), milestones: ((result.data.milestones || []) as Record<string, unknown>[]).map(row => pick(row, ['id', 'name', 'due_date', 'status', 'assignee_user_id', 'sort_no', 'remark', 'completed_at', 'row_version'])) } }
}
