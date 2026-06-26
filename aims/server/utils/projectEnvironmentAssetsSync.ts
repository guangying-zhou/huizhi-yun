import { createError, getHeader, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import {
  projectEnvironmentDeploymentStatus,
  projectEnvironmentLifecycleStatus
} from './projectEnvironmentAssetsSyncMapping'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface UpstreamErrorPayload {
  code?: string | number
  message?: string
  data?: {
    code?: string | number
    message?: string
  }
}

export interface ProjectEnvironmentAssetsSyncInput {
  idempotencyKey: string
  projectCode: string
  environmentCode: string
  deliveryAssetCode?: string
  relationType?: string
  deliveryStatus?: string
  isPrimary?: boolean
  deliveryVersionSnapshot?: string
  effectiveFrom?: string
  effectiveTo?: string
  actualGoLiveAt?: string
  acceptedAt?: string
  operatorUid: string
  body?: Record<string, unknown>
}

export interface ProjectEnvironmentAssetsSyncResult {
  assetsBind: Record<string, unknown> | null
  assetsLifecycle: Record<string, unknown> | null
  assetsSyncStatus: 'synced' | 'failed'
  assetsSyncError: string
}

function text(value: unknown) {
  return String(value || '').trim()
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
    data?: UpstreamErrorPayload
    statusMessage?: string
    message?: string
  }
  const upstreamStatus = Number(value?.statusCode || value?.status || value?.response?.status || 502)
  const code = value?.data?.data?.code || value?.data?.code
  const message = text(value?.data?.data?.message || value?.data?.message || value?.statusMessage || value?.message) || fallback
  return createError({
    statusCode: upstreamStatus,
    message,
    data: {
      code,
      message,
      upstreamStatus
    }
  })
}

async function callAssetsService<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:write',
    event
  })
  let response: RuntimeEnvelope<T>
  try {
    response = await $fetch<RuntimeEnvelope<T>>(appendPath(resolveAssetsBaseUrl(event), path), {
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
    throw serviceError(error, 'Assets service API request failed.')
  }
  if (response.code !== undefined && response.code !== 0) {
    const upstreamStatus = Number((response.data as { upstreamStatus?: unknown } | undefined)?.upstreamStatus || 502)
    const message = response.message || 'Assets service API returned an error.'
    throw createError({
      statusCode: upstreamStatus,
      message,
      data: {
        code: response.code,
        message,
        upstreamStatus
      }
    })
  }
  return response.data as T
}

function deliveryAssetRelationType(body: Record<string, unknown>, relationType: string, isPrimary: boolean) {
  const explicit = firstText(body, 'assetRelationType', 'asset_relation_type', 'deliveryAssetRelationType', 'delivery_asset_relation_type')
  if (explicit) return explicit
  if (isPrimary) return 'primary'
  if (relationType === 'verification') return 'test'
  if (relationType === 'decommission') return 'other'
  return 'production'
}

export async function syncProjectEnvironmentAssets(event: H3Event, input: ProjectEnvironmentAssetsSyncInput): Promise<ProjectEnvironmentAssetsSyncResult> {
  const body = input.body || {}
  let assetsBind: Record<string, unknown> | null = null
  let assetsLifecycle: Record<string, unknown> | null = null
  let assetsSyncStatus: 'synced' | 'failed' = 'synced'
  let assetsSyncError = ''

  try {
    if (input.deliveryAssetCode) {
      const targetDeploymentStatus = projectEnvironmentDeploymentStatus(input.deliveryStatus || 'planned')
      assetsBind = await callAssetsService<Record<string, unknown>>(
        event,
        `/api/v1/service/customer-delivery-assets/${encodeURIComponent(input.deliveryAssetCode)}/environments:bind`,
        {
          environmentCode: input.environmentCode,
          relationType: deliveryAssetRelationType(body, input.relationType || 'initial_delivery', Boolean(input.isPrimary)),
          isPrimary: Boolean(input.isPrimary),
          deploymentStatus: targetDeploymentStatus,
          deployedVersion: input.deliveryVersionSnapshot || undefined,
          effectiveFrom: input.effectiveFrom || undefined,
          effectiveTo: input.effectiveTo || undefined,
          status: targetDeploymentStatus === 'removed' ? 'ended' : 'active',
          sourceProjectCode: input.projectCode,
          operatorUid: input.operatorUid
        },
        `${input.idempotencyKey}:bind`
      )
    }
    const lifecycleStatus = projectEnvironmentLifecycleStatus(input.deliveryStatus || '')
    if (lifecycleStatus) {
      assetsLifecycle = await callAssetsService<Record<string, unknown>>(
        event,
        `/api/v1/service/environments/${encodeURIComponent(input.environmentCode)}/lifecycle:sync`,
        {
          status: lifecycleStatus,
          sourceProjectCode: input.projectCode,
          goLiveAt: input.actualGoLiveAt || undefined,
          acceptedAt: input.acceptedAt || undefined,
          operatorUid: input.operatorUid
        },
        `${input.idempotencyKey}:lifecycle:${lifecycleStatus}`
      )
    }
  } catch (error) {
    assetsSyncStatus = 'failed'
    assetsSyncError = text((error as { message?: string })?.message) || 'Assets sync failed.'
  }

  return {
    assetsBind,
    assetsLifecycle,
    assetsSyncStatus,
    assetsSyncError
  }
}
