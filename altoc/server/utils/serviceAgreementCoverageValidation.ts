import { createError, getHeader, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import {
  coverageFormalTargetFromBody,
  serviceAgreementCoverageReferenceIssue,
  serviceAgreementCoverageRuntimeErrorStatus,
  type AssetsReferenceResolution,
  type ReferenceIssue
} from './serviceAgreementCoverageReferences'

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

async function loadServiceAgreementCustomerCode(event: H3Event, agreementCode: string) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<{ service_agreement?: Record<string, unknown> }>>(
    event,
    `/v1/altoc/service/service-agreements/${encodeURIComponent(agreementCode)}/coverages`,
    {
      appCode: 'altoc',
      scope: 'altoc.read altoc:contract:view',
      method: 'GET',
      query: {}
    }
  )
  if (!runtime.handled) return ''
  if (runtime.data.code !== undefined && runtime.data.code !== 0) return ''
  const agreement = objectBody(runtime.data.data?.service_agreement)
  return firstText(agreement, 'customer_code', 'customerCode')
}

async function writeServiceAgreementCoverageRuntime(
  event: H3Event,
  path: string,
  body: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:contract:edit',
    method: 'POST',
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for service agreement coverage writes.' })
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

function runtimeCoverageCommandSegment(value: string) {
  const normalized = text(value)
  for (const action of ['resolve', 'suspend', 'end', 'confirm-legacy']) {
    const suffix = `:${action}`
    if (normalized.endsWith(suffix)) {
      const coverageCode = normalized.slice(0, -suffix.length)
      if (!coverageCode) {
        throw createError({ statusCode: 400, message: 'coverageCode is required.' })
      }
      return `${encodeURIComponent(coverageCode)}${suffix}`
    }
  }
  throw createError({ statusCode: 404, message: 'Unsupported service agreement coverage action.' })
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
  agreementCode: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const target = coverageFormalTargetFromBody(body)
  if (!target.requiresValidation) return

  const expectedCustomerCode = firstText(body, 'customerCode', 'customer_code')
    || await loadServiceAgreementCustomerCode(event, agreementCode)
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

export async function handleServiceAgreementCoverageWrite(event: H3Event, input: {
  agreementCode: string
  coverageCommand?: string
}) {
  const body = objectBody(await readBody(event).catch(() => ({})))
  const action = text(input.coverageCommand)
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `altoc:service-agreement:${input.agreementCode}:coverage:${action || firstText(body, 'coverageCode', 'coverage_code') || 'upsert'}`

  await validateFormalTargetIfNeeded(event, input.agreementCode, body, `${idempotencyKey}:assets-reference-validate`)

  const runtimePath = action
    ? `/v1/altoc/service/service-agreements/${encodeURIComponent(input.agreementCode)}/coverages/${runtimeCoverageCommandSegment(action)}`
    : `/v1/altoc/service/service-agreements/${encodeURIComponent(input.agreementCode)}/coverages`
  return await writeServiceAgreementCoverageRuntime(event, runtimePath, body)
}
