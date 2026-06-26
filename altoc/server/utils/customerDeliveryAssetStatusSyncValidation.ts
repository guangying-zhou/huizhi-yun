import { createError, getHeader, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import {
  serviceAgreementCoverageReferenceIssue,
  serviceAgreementCoverageRuntimeErrorStatus,
  type AssetsReferenceResolution,
  type ReferenceIssue
} from './serviceAgreementCoverageReferences'
import { deliveryAssetStatusSyncFormalTarget } from './customerDeliveryAssetStatusSyncReferences'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function firstText(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  const base = trimTrailingSlash(baseUrl)
  const normalizedPath = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalizedPath.startsWith('api/v1/')) {
    return `${base}/${normalizedPath.slice('api/v1/'.length)}`
  }
  if (base.endsWith('/api') && normalizedPath.startsWith('api/')) {
    return `${base}/${normalizedPath.slice('api/'.length)}`
  }
  return `${base}/${normalizedPath}`
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

function resolveAssetsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }
  return baseUrl
}

function serviceError(error: unknown, fallback: string) {
  const value = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
    data?: { error?: { code?: string, message?: string }, code?: string | number, message?: string, data?: { code?: string | number, message?: string } }
    statusMessage?: string
    message?: string
  }
  const upstreamStatus = Number(value?.statusCode || value?.status || value?.response?.status || 502)
  const code = value?.data?.data?.code || value?.data?.error?.code || value?.data?.code
  const message = text(value?.data?.data?.message || value?.data?.error?.message || value?.data?.message || value?.statusMessage || value?.message) || fallback
  return createError({
    statusCode: upstreamStatus,
    message,
    data: { code, message, upstreamStatus }
  })
}

async function callAssetsReferencesResolve(
  event: H3Event,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:read',
    event
  })
  let response: RuntimeEnvelope<AssetsReferenceResolution>
  try {
    response = await $fetch<RuntimeEnvelope<AssetsReferenceResolution>>(appendPath(resolveAssetsBaseUrl(event), '/api/v1/service/references:resolve'), {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event, idempotencyKey),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body,
      timeout: 10000
    })
  } catch (error) {
    throw serviceError(error, 'Assets reference validation failed.')
  }
  if (response.code !== undefined && response.code !== 0) {
    const message = response.message || 'Assets reference validation failed.'
    throw createError({
      statusCode: 502,
      message,
      data: { code: response.code, message, upstreamStatus: 502 }
    })
  }
  return response.data || {}
}

function throwReferenceIssue(issue: ReferenceIssue) {
  throw createError({
    statusCode: issue.statusCode,
    message: issue.message,
    data: {
      code: issue.code,
      message: issue.message,
      upstreamStatus: issue.statusCode
    }
  })
}

async function validateFormalTargetIfNeeded(
  event: H3Event,
  target: FormalCoverageTarget,
  idempotencyKey: string,
  expectedCustomerCode: string
) {
  if (!target.requiresValidation) return
  const resolution = await callAssetsReferencesResolve(event, {
    deliveryAssetCodes: target.deliveryAssetCode ? [target.deliveryAssetCode] : [],
    environmentCodes: target.environmentCode ? [target.environmentCode] : [],
    pairs: target.deliveryAssetCode && target.environmentCode
      ? [{ deliveryAssetCode: target.deliveryAssetCode, environmentCode: target.environmentCode }]
      : []
  }, idempotencyKey)
  const issue = serviceAgreementCoverageReferenceIssue(target, resolution, expectedCustomerCode)
  if (issue) throwReferenceIssue(issue)
}

function runtimeEnvelopeErrorCode(envelope: RuntimeEnvelope<Record<string, unknown>>) {
  const data = objectBody(envelope.data)
  const nested = objectBody(data.error)
  return firstText(data, 'code', 'errorCode')
    || firstText(nested, 'code', 'errorCode')
    || (typeof envelope.code === 'string' ? text(envelope.code) : '')
}

function runtimeEnvelopeErrorMessage(envelope: RuntimeEnvelope<Record<string, unknown>>, fallback: string) {
  const data = objectBody(envelope.data)
  const nested = objectBody(data.error)
  return firstText(data, 'message')
    || firstText(nested, 'message')
    || text(envelope.message)
    || fallback
}

function runtimeEnvelopeExplicitStatus(envelope: RuntimeEnvelope<Record<string, unknown>>) {
  const data = objectBody(envelope.data)
  const nested = objectBody(data.error)
  return data.statusCode || data.status || data.upstreamStatus
    || nested.statusCode || nested.status || nested.upstreamStatus
}

async function writeStatusSyncRuntime(
  event: H3Event,
  path: string,
  body: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:contract:delivery-asset-status:sync',
    method: 'POST',
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for delivery asset status sync.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    const code = runtimeEnvelopeErrorCode(runtime.data)
    const message = runtimeEnvelopeErrorMessage(runtime.data, 'Altoc tenant-runtime returned an error.')
    const upstreamStatus = serviceAgreementCoverageRuntimeErrorStatus(code, runtimeEnvelopeExplicitStatus(runtime.data))
    throw createError({
      statusCode: upstreamStatus,
      message,
      data: { code: code || runtime.data.code, message, upstreamStatus }
    })
  }
  return runtime.data
}

async function loadDeliveryAssetStatusSyncExpectedCustomerCode(
  event: H3Event,
  deliveryAssetCode: string,
  body: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    `/v1/altoc/service/customer-delivery-assets/${encodeURIComponent(deliveryAssetCode)}/status-sync-context`,
    {
      appCode: 'altoc',
      scope: 'altoc.read altoc:contract:view',
      method: 'GET',
      query: {
        sourcePlanCode: firstText(body, 'sourcePlanCode', 'source_plan_code'),
        contractCode: firstText(body, 'contractCode', 'contract_code', 'sourceContractCode', 'source_contract_code'),
        contractLineCode: firstText(body, 'contractLineCode', 'contract_line_code', 'sourceContractLineCode', 'source_contract_line_code')
      }
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for delivery asset status sync validation.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    const code = runtimeEnvelopeErrorCode(runtime.data)
    const message = runtimeEnvelopeErrorMessage(runtime.data, 'Altoc tenant-runtime returned an error.')
    const upstreamStatus = serviceAgreementCoverageRuntimeErrorStatus(code, runtimeEnvelopeExplicitStatus(runtime.data))
    throw createError({
      statusCode: upstreamStatus,
      message,
      data: { code: code || runtime.data.code, message, upstreamStatus }
    })
  }
  const data = objectBody(runtime.data.data)
  return firstText(data, 'expectedCustomerCode', 'expected_customer_code')
}

export async function handleCustomerDeliveryAssetStatusSync(event: H3Event, input: {
  deliveryAssetCode: string
  statusCommand: string
}) {
  if (text(input.statusCommand) !== 'status:sync') {
    throw createError({ statusCode: 404, message: 'Unsupported customer delivery asset command.' })
  }
  const body = objectBody(await readBody(event).catch(() => ({})))
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `altoc:customer-delivery-asset:${input.deliveryAssetCode}:status-sync`
  const { target, issue } = deliveryAssetStatusSyncFormalTarget(input.deliveryAssetCode, body)
  if (issue) throwReferenceIssue(issue)
  const expectedCustomerCode = await loadDeliveryAssetStatusSyncExpectedCustomerCode(event, input.deliveryAssetCode, body)
  await validateFormalTargetIfNeeded(event, target, `${idempotencyKey}:assets-reference-validate`, expectedCustomerCode)
  return await writeStatusSyncRuntime(
    event,
    `/v1/altoc/service/customer-delivery-assets/${encodeURIComponent(input.deliveryAssetCode)}/status:sync`,
    body
  )
}
