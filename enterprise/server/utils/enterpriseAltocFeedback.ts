import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { buildAPFPermit } from './enterpriseAPF'
import { requireEnterpriseProductPermission } from './enterpriseProductAuthorization'

type FeedbackOperation = 'view' | 'submit' | 'resume'
const fields = ['submitted', 'submissionId', 'requestBizId', 'productCode', 'status', 'expectedSourceSha256', 'title', 'description', 'decisionStatus', 'canonicalRequestBizId', 'sourceRevision', 'canonicalDecisionStatus', 'versions', 'progressPending']
const pick = (data: Record<string, unknown>) => Object.fromEntries(fields.filter(k => k in data).map(k => [k, data[k]]))
export async function enterpriseAltocFeedback(event: H3Event, action: FeedbackOperation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const id = getRouterParam(event, 'ticketId') || ''
  if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const raw = action === 'view' ? {} : await readBody<Record<string, unknown>>(event)
  const allowed = action === 'submit' ? ['expectedSourceSha256'] : []
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw).some(k => !allowed.includes(k)) || (action === 'submit' && !/^[0-9a-f]{64}$/.test(String(raw.expectedSourceSha256)))) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'idempotency-key')
  if (action !== 'view' && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  async function call(a: FeedbackOperation, payload: Record<string, unknown>) {
    const op = `altoc.apf16f-product-feedback-${a}` as Parameters<typeof callEnterpriseRuntime>[1]
    await prepareEnterpriseRuntime(event, op)
    const authorization = { ...await buildAPFPermit(event, 'altoc', 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'service_ticket', 'edit'), operation: `product-feedback-${a}` }
    const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, op, { sales: { id, payload }, authorization }, a === 'view' ? {} : { idempotencyKey: key })
    if (result.code !== 0 || !result.data || typeof result.data.submitted !== 'boolean' || typeof result.data.productCode !== 'string') throw createError({ statusCode: 503 })
    return pick(result.data)
  }
  if (action === 'view') return { code: 0, data: await call('view', {}) }
  // Product is read from the scoped authoritative source, not the request body.
  const source = await call('view', {})
  const permit = await requireEnterpriseProductPermission(event, source.productCode as string, 'create')
  const data = await call(action, { ...raw, productAuthorization: JSON.stringify(permit.authorization) })
  // Durable freeze precedes user-driven delivery. Failure leaves the original
  // command available via resume, never a new producer or scheduled owner.
  if (action === 'submit' && data.status !== 'succeeded') return { code: 0, data: await call('resume', { productAuthorization: JSON.stringify(permit.authorization) }) }
  return { code: 0, data }
}
