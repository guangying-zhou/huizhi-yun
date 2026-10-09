import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { altocReadFields } from '../../shared/altoc-basic-read'
import { buildAPFPermit } from './enterpriseAPF'

export const salesOperations = {
  'leads-create': ['lead', 'edit'], 'leads-update': ['lead', 'edit'], 'leads-assign': ['lead', 'assign'], 'leads-disqualify': ['lead', 'disqualify'], 'leads-convert': ['lead', 'convert'], 'lead-activities-create': ['lead', 'activity'],
  'opportunities-create': ['opportunity', 'edit'], 'opportunities-update': ['opportunity', 'edit'], 'opportunities-assign': ['opportunity', 'assign'], 'opportunities-transition': ['opportunity', 'transition'], 'opportunities-close-won': ['opportunity', 'transition'], 'opportunities-close-lost': ['opportunity', 'transition'], 'opportunities-pause': ['opportunity', 'transition'], 'opportunities-reopen': ['opportunity', 'transition'], 'opportunity-activities-create': ['opportunity', 'activity']
} as const
export type SalesOperation = keyof typeof salesOperations
const leadFields = ['name', 'org_name', 'source_type', 'source_detail', 'need_summary', 'project_type', 'estimated_budget', 'budget_status', 'expected_procurement_date', 'procurement_mode', 'source_evidence_url', 'contact_name', 'contact_mobile', 'contact_email', 'remark', 'next_action', 'next_action_due_at']
const opportunityFields = ['name', 'source_type', 'source_detail', 'forecast_category', 'currency_code', 'next_action', 'next_action_due_at', 'risk_level', 'risk_reason', 'competitor_info', 'remark', 'amount_tax_inclusive', 'expected_sign_date', 'expected_payment_date']
export function normalizeSalesPayload(operation: SalesOperation, raw: Record<string, unknown>) {
  const [resource, action] = salesOperations[operation]
  const create = operation === 'leads-create' || operation === 'opportunities-create'
  let fields: string[] = []
  if (action === 'edit') fields = resource === 'lead' ? leadFields : opportunityFields
  if (create || action === 'assign') fields = [...fields, 'owner_uid', 'owner_dept_code']
  if (create && resource === 'opportunity') fields = [...fields, 'customerId', 'stageId']
  if (action === 'activity') fields = ['activity_type', 'subject', 'content', 'result_summary', 'activity_at', 'next_action', 'next_action_due_at']
  if (action === 'disqualify') fields = ['invalid_reason_code', 'invalid_reason']
  if (action === 'convert') fields = ['customerId', 'contactId', 'stageId', 'customer_name', 'opportunity_name', 'contact_name', 'contact_mobile', 'contact_email', 'owner_uid', 'owner_dept_code', 'ack_similar_opportunity']
  if (action === 'transition') fields = [...opportunityFields.filter(k => k !== 'name'), 'change_reason', 'won_reason_code', 'won_reason', 'lost_reason_code', 'lost_reason', 'pause_reason_code', 'pause_reason', ...(['opportunities-transition', 'opportunities-reopen'].includes(operation) ? ['stageId'] : [])]
  if (!create) fields = [...fields, 'expectedVersion']
  if (Object.keys(raw).some(k => !fields.includes(k)) || Object.values(raw).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw createError({ statusCode: 400, message: '请检查输入字段' })
  if (!create && (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)) throw createError({ statusCode: 400, message: '资料版本无效，请刷新后重试' })
  if (create && ['name', 'owner_uid'].some(k => typeof raw[k] !== 'string' || !String(raw[k]).trim())) throw createError({ statusCode: 400, message: '名称和负责人为必填项' })
  return raw
}
export async function enterpriseAltocSales(event: H3Event, operation: SalesOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!Object.hasOwn(salesOperations, operation) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400 })
  const [resource, action] = salesOperations[operation]
  const create = operation === 'leads-create' || operation === 'opportunities-create'
  const id = getRouterParam(event, `${resource}Id`) || ''
  if (create ? Boolean(id) : !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'idempotency-key')
  if (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) throw createError({ statusCode: 400 })
  const sales = { id, payload: normalizeSalesPayload(operation, raw) }
  const op = `altoc.apf07-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, resource, action), operation }
  const result = await callEnterpriseRuntime<{ code: number, data: { data: Record<string, unknown> } }>(event, op, { sales, authorization }, { idempotencyKey: key })
  const row = result.data?.data
  if (result.code !== 0 || !row || !/^[1-9]\d{0,15}$/.test(String(row.id)) || (id && String(row.id) !== id) || !Number.isSafeInteger(row.row_version) || Number(row.row_version) < 1) throw createError({ statusCode: 503 })
  return { data: Object.fromEntries(altocReadFields[resource].filter(k => k in row).map(k => [k, row[k]])) }
}
