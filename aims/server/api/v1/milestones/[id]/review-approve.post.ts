/**
 * 里程碑评审通过回调（幂等）
 * POST /api/v1/milestones/:id/review-approve
 *
 * 通过后当前里程碑置 completed，下一个未完成里程碑自动激活。
 * Aims 已迁移到 tenant-runtime/data-runtime，本接口只负责鉴权上下文与转发。
 */
import { createError, getHeader, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface ReviewApproveResult {
  milestoneId: number
  milestone_id?: number
  approved?: boolean
  alreadyCompleted?: boolean
  nextMilestoneId: number | null
  next_milestone_id?: number | null
  paymentTermId?: number | string | null
  payment_term_id?: number | string | null
  projectCode?: string | null
  project_code?: string | null
  contractCode?: string | null
  contract_code?: string | null
}

interface AltocMarkBillableResult {
  receivablePlan?: Record<string, unknown>
  changed?: boolean
  idempotent?: boolean
}

interface ServiceEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function positiveIdText(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.trunc(parsed)) : ''
}

function milestoneIdempotencyKey(milestoneId: number, projectCode: string) {
  return projectCode
    ? `aims:milestone:${projectCode}:${milestoneId}:accepted:v1`
    : `aims:milestone:${milestoneId}:accepted:v1`
}

function forwardedContextHeaders(event: H3Event, idempotencyKey: string) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

async function callAltocMarkBillable(
  event: H3Event,
  path: string,
  milestoneId: number,
  projectCode: string,
  uid: string
) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  }
  const idempotencyKey = milestoneIdempotencyKey(milestoneId, projectCode)
  const token = await requestServiceAccessToken({
    audience: 'altoc',
    scope: 'altoc:write altoc:receivable:mark-billable',
    event
  })
  const response = await $fetch<ServiceEnvelope<AltocMarkBillableResult>>(
    appendPath(baseUrl, path),
    {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event, idempotencyKey),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: {
        milestoneId,
        operatorUid: uid,
        idempotencyKey
      },
      timeout: 10000
    }
  )
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Altoc service API returned an error.' })
  }
  return response.data || null
}

async function markReceivablePlanBillable(event: H3Event, receivablePlanCode: string, milestoneId: number, projectCode: string, uid: string) {
  return callAltocMarkBillable(
    event,
    `/api/v1/service/receivable-plans/${encodeURIComponent(receivablePlanCode)}/mark-billable`,
    milestoneId,
    projectCode,
    uid
  )
}

async function markPaymentTermReceivablePlanBillable(event: H3Event, paymentTermId: string, milestoneId: number, projectCode: string, uid: string) {
  return callAltocMarkBillable(
    event,
    `/api/v1/service/payment-terms/${encodeURIComponent(paymentTermId)}/receivable-plan:mark-billable`,
    milestoneId,
    projectCode,
    uid
  )
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const milestoneId = Number(getRouterParam(event, 'id'))
  if (!milestoneId || Number.isNaN(milestoneId)) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }

  const body = objectBody(await readBody(event).catch(() => ({})))
  const data = await forwardAimsRuntimePost<ReviewApproveResult>(
    event,
    `/v1/aims/milestones/${milestoneId}/review-approve`,
    { uid }
  )

  const receivablePlanCode = text(body.receivablePlanCode || body.receivable_plan_code)
  const paymentTermId = positiveIdText(data.paymentTermId || data.payment_term_id || body.paymentTermId || body.payment_term_id)
  const projectCode = text(data.projectCode || data.project_code)
  const billable = receivablePlanCode
    ? await markReceivablePlanBillable(event, receivablePlanCode, milestoneId, projectCode, uid)
    : paymentTermId
      ? await markPaymentTermReceivablePlanBillable(event, paymentTermId, milestoneId, projectCode, uid)
      : null

  return { code: 0, data: { ...data, receivablePlan: billable } }
})
