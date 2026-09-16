import { createError, getQuery, getRouterParam, readBody, setHeader, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { dispatchProductFeedback } from './productFeedbackDispatch'
import { requirePermission } from './checkPermission'
import { getRequestUid } from './authIdentity'
import { resolveCurrentAltocDataAccessQuery } from './altocScopedAuthorization'

type Row = Record<string, unknown>

export async function handleProductFeedbackSubmission(event: H3Event, mode: boolean | 'resume') {
  const submit = mode === true
  const resume = mode === 'resume'
  setHeader(event, 'cache-control', 'no-store')
  const ticketCode = getRouterParam(event, 'ticketCode') || ''
  // eslint-disable-next-line no-control-regex -- reject controls in path identifiers
  if (!ticketCode || ticketCode.trim() !== ticketCode || [...ticketCode].length > 30 || /[\u0000-\u001f\u007f/\\]/.test(ticketCode) || Object.keys(getQuery(event)).length) {
    throw createError({ statusCode: 400, message: 'Invalid feedback request.' })
  }
  await requirePermission(event, 'service_ticket', 'edit')
  const actor = getRequestUid(event)
  if (!actor) throw createError({ statusCode: 401, message: 'Current user is required.' })
  const query = await resolveCurrentAltocDataAccessQuery(event, 'service_ticket', 'edit')
  let body: Row | undefined
  if (resume) {
    const input: unknown = await readBody(event)
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
      throw createError({ statusCode: 400, message: 'Resume accepts an empty object only.' })
    }
  }
  if (submit) {
    const input: unknown = await readBody(event)
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('expectedSourceSha256' in input) || typeof input.expectedSourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSourceSha256)) {
      throw createError({ statusCode: 400, message: 'Expected source digest is required.' })
    }
    body = { expectedSourceSha256: input.expectedSourceSha256 }
  }
  const response = await maybeCallTenantRuntime<{ code: number, data: Row }>(event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}/product-request${submit ? ':freeze' : ''}`, {
      appCode: 'altoc', method: submit ? 'POST' : 'GET',
      scope: `altoc.${submit ? 'write' : 'read'} altoc:service_ticket:edit`,
      query, ...(body ? { body } : {})
    })
  if (!response.handled || response.data.code !== 0 || !response.data.data || typeof response.data.data !== 'object') {
    throw createError({ statusCode: 503, message: 'Product feedback runtime is unavailable.' })
  }
  const source = response.data.data
  if (resume && source.submitted !== true) throw createError({ statusCode: 409, message: 'No feedback submission exists for this ticket.' })
  if ((submit || resume) && await dispatchProductFeedback(event, query, ticketCode, source)) source.status = 'succeeded'
  const data: Row = {}
  const fields = submit || resume
    ? ['submissionId', 'requestBizId', 'productCode', 'status', 'created']
    : ['submitted', 'expectedSourceSha256', 'productCode', 'title', 'description', 'submissionId', 'requestBizId', 'status', 'decisionStatus', 'canonicalRequestBizId', 'sourceRevision', 'canonicalDecisionStatus', 'versions', 'progressSourceRevision', 'progressPending']
  for (const key of fields) if (Object.hasOwn(source, key)) data[key] = source[key]
  if (submit || resume) setResponseStatus(event, 202)
  return { code: 0, message: submit || resume ? 'accepted' : 'ok', data }
}
