import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { agreementFields, coverageFields, agreementRowFields, coverageRowFields, projectRowFields, serviceAgreementOperations, type ServiceAgreementOperation } from '../../shared/altoc-service-agreements'
import { buildAPFPermit } from './enterpriseAPF'

export function normalizeServiceAgreementPayload(op: ServiceAgreementOperation, raw: Record<string, unknown>) {
  const page = op.endsWith('-page')
  const create = op === 'service-agreements-create'
  let fields: string[] = []
  if (page) fields = ['page', 'pageSize', 'search']
  else if (op === 'service-agreements-view') fields = []
  else if (op.startsWith('service-agreements-')) fields = [...agreementFields, ...(create ? ['contract_id', 'contract_line_id'] : [])]
  else if (op === 'service-coverages-create' || op === 'service-coverages-resolve') fields = [...coverageFields, ...(op.endsWith('-resolve') ? ['childId'] : [])]
  else if (op === 'service-projects-bind') fields = ['project_code', 'project_role']
  else fields = ['childId']
  if (!page && !create && op !== 'service-agreements-view') fields.push('expectedVersion')
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查服务协议输入字段' })
  if (page) {
    raw = { page: 1, pageSize: 20, ...raw }
    for (const key of ['page', 'pageSize']) {
      const n = Number(raw[key])
      if (!Number.isSafeInteger(n) || n < 1 || n > (key === 'pageSize' ? 100 : 1000000)) throw createError({ statusCode: 400, message: '分页参数无效' })
      raw[key] = n
    }
  } else if (!create && op !== 'service-agreements-view' && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)) throw createError({ statusCode: 400, message: '请刷新资料版本后重试' })
  if (create && (!String(raw.name || '').trim() || !/^[1-9]\d{0,15}$/.test(String(raw.contract_id)))) throw createError({ statusCode: 400, message: '名称和合同为必填项' })
  return raw
}
const pick = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]]))
export async function enterpriseAltocServiceAgreements(event: H3Event, operation: ServiceAgreementOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!serviceAgreementOperations.includes(operation)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const page = operation.endsWith('-page')
  const read = page || operation === 'service-agreements-view'
  const create = operation === 'service-agreements-create'
  const id = getRouterParam(event, 'agreementId') || ''
  if (operation === 'service-agreements-page' || create ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  if (!read && Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = read ? { ...getQuery(event) } : await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const childId = getRouterParam(event, 'childId')
  if (childId) {
    if (!/^[1-9]\d{0,15}$/.test(childId) || Object.hasOwn(raw, 'childId')) throw createError({ statusCode: 400 })
    raw.childId = childId
  }
  const payload = normalizeServiceAgreementPayload(operation, raw)
  const key = getHeader(event, 'idempotency-key')
  if (!read && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16b-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', read ? 'view' : 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'contract', read ? undefined : 'edit'), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, read ? {} : { idempotencyKey: key })
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503 })
  if (!read) {
    if (!/^[1-9]\d{0,15}$/.test(String(result.data.id))) throw createError({ statusCode: 503 })
    return { code: 0, data: { id: result.data.id } }
  }
  const fields = operation.startsWith('service-coverages-') ? coverageRowFields : operation.startsWith('service-projects-') ? projectRowFields : agreementRowFields
  if (page) {
    if (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)) throw createError({ statusCode: 503 })
    return { code: 0, data: { items: result.data.items.map(row => pick(row, fields)), total: result.data.total } }
  }
  if (String(result.data.id) !== id) throw createError({ statusCode: 503 })
  return { code: 0, data: pick(result.data, fields) }
}
