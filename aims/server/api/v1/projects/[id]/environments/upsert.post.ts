import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { syncProjectEnvironmentAssets } from '~~/server/utils/projectEnvironmentAssetsSync'
import {
  buildAssetsEnvironmentUpsertPayload,
  normalizeProjectEnvironmentDeliveryStatus,
  normalizeProjectEnvironmentRelationType,
  projectEnvironmentIdempotencyKey
} from '~~/server/utils/projectEnvironmentIdentity'

interface RuntimeProject {
  id?: number | string
  projectCode?: string
  project_code?: string
  name?: string
  customerCode?: string
  customer_code?: string
  contractCode?: string
  contract_code?: string
}

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

interface ProjectEnvironmentResult {
  project?: RuntimeProject
  relation?: Record<string, unknown>
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RequestBody {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RequestBody
  return {}
}

function firstText(body: RequestBody, ...keys: string[]) {
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

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return text(project[camel] ?? project[snake])
}

function boolInput(body: RequestBody, ...keys: string[]) {
  for (const key of keys) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value === 'boolean') return value
    const normalized = text(value).toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
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

function resolveAssetsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }
  return baseUrl
}

async function callAssetsService<T>(
  event: H3Event,
  path: string,
  body: RequestBody,
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

async function loadProject(event: H3Event, projectId: number, uid: string) {
  const query = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
  const project = await forwardAimsRuntimeGet<RuntimeProject>(
    event,
    `/v1/aims/projects/${projectId}`,
    { uid, query }
  )
  if (!project || !projectField(project, 'projectCode', 'project_code')) {
    throw createError({ statusCode: 404, message: '项目不存在或无权访问' })
  }
  return project
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const body = objectBody(await readBody(event).catch(() => ({})))
  const requestedEnvironmentCode = firstText(body, 'environmentCode', 'environment_code')
  const requestedEnvironmentName = firstText(body, 'environmentName', 'environment_name')
  if (!requestedEnvironmentCode && !requestedEnvironmentName) {
    throw createError({ statusCode: 400, message: 'environmentCode or environmentName is required.' })
  }

  const project = await loadProject(event, projectId, uid)
  const projectCode = projectField(project, 'projectCode', 'project_code')
  const customerCode = firstText(body, 'customerCode', 'customer_code') || projectField(project, 'customerCode', 'customer_code')
  const contractCode = firstText(body, 'contractCode', 'contract_code') || projectField(project, 'contractCode', 'contract_code')
  if (!customerCode) {
    throw createError({ statusCode: 400, message: 'customerCode is required for environment identity.' })
  }
  const deliveryAssetCode = firstText(body, 'deliveryAssetCode', 'delivery_asset_code')
  const deliveryStatusInput = firstText(body, 'deliveryStatus', 'delivery_status', 'status') || 'planned'
  const deliveryStatus = normalizeProjectEnvironmentDeliveryStatus(deliveryStatusInput)
  if (!deliveryStatus) {
    throw createError({
      statusCode: 400,
      message: 'invalid project environment status',
      data: { code: 'invalid_environment_transition' }
    })
  }
  const relationType = normalizeProjectEnvironmentRelationType(firstText(body, 'relationType', 'relation_type'))
  const isPrimary = boolInput(body, 'isPrimary', 'is_primary')
  const idempotencyKey = projectEnvironmentIdempotencyKey({
    explicitIdempotencyKey: text(getHeader(event, 'idempotency-key')),
    projectCode,
    body
  })

  const environment = await callAssetsService<Record<string, unknown>>(
    event,
    '/api/v1/service/environments/upsert',
    buildAssetsEnvironmentUpsertPayload({
      body,
      requestedEnvironmentCode,
      idempotencyKey,
      customerCode,
      contractCode,
      projectCode,
      operatorUid: uid
    }),
    idempotencyKey
  )
  const environmentCode = text(environment.environmentCode || environment.environment_code || requestedEnvironmentCode)
  if (!environmentCode) {
    throw createError({ statusCode: 502, message: 'Assets did not return environmentCode.' })
  }

  const aimsUpsert = await forwardAimsRuntimePost<ProjectEnvironmentResult>(
    event,
    `/v1/aims/service/projects/${encodeURIComponent(projectCode)}/environments`,
    {
      uid,
      body: {
        environmentCode,
        deliveryAssetCode: deliveryAssetCode || undefined,
        relationType,
        deliveryStatus,
        isPrimary,
        plannedGoLiveAt: firstText(body, 'plannedGoLiveAt', 'planned_go_live_at') || undefined,
        actualGoLiveAt: firstText(body, 'actualGoLiveAt', 'actual_go_live_at') || undefined,
        acceptedAt: firstText(body, 'acceptedAt', 'accepted_at') || undefined,
        handoverStatus: firstText(body, 'handoverStatus', 'handover_status') || undefined,
        handoverAt: firstText(body, 'handoverAt', 'handover_at') || undefined,
        deliveryVersionSnapshot: firstText(body, 'deliveryVersionSnapshot', 'delivery_version_snapshot', 'deployedVersion', 'deployed_version') || undefined,
        assetsSyncStatus: 'pending',
        sourceContractLineCode: firstText(body, 'sourceContractLineCode', 'source_contract_line_code') || undefined,
        sourceObligationCode: firstText(body, 'sourceObligationCode', 'source_obligation_code') || undefined
      }
    }
  )

  const syncResult = await syncProjectEnvironmentAssets(event, {
    idempotencyKey,
    projectCode,
    environmentCode,
    deliveryAssetCode,
    relationType,
    deliveryStatus,
    isPrimary,
    deliveryVersionSnapshot: firstText(body, 'deliveryVersionSnapshot', 'delivery_version_snapshot', 'deployedVersion', 'deployed_version') || undefined,
    effectiveFrom: firstText(body, 'effectiveFrom', 'effective_from') || undefined,
    effectiveTo: firstText(body, 'effectiveTo', 'effective_to') || undefined,
    actualGoLiveAt: firstText(body, 'actualGoLiveAt', 'actual_go_live_at') || undefined,
    acceptedAt: firstText(body, 'acceptedAt', 'accepted_at') || undefined,
    operatorUid: uid,
    body
  })
  let assetsSyncStatus = syncResult.assetsSyncStatus
  let assetsSyncError = syncResult.assetsSyncError

  let syncUpdate: ProjectEnvironmentResult | null = null
  try {
    syncUpdate = await forwardAimsRuntimePost<ProjectEnvironmentResult>(
      event,
      `/v1/aims/service/projects/${encodeURIComponent(projectCode)}/environments/${encodeURIComponent(environmentCode)}:assets-sync`,
      {
        uid,
        body: {
          deliveryAssetCode: deliveryAssetCode || undefined,
          relationType,
          assetsSyncStatus,
          assetsSyncError: assetsSyncError || undefined
        }
      }
    )
  } catch (error) {
    assetsSyncStatus = 'failed'
    assetsSyncError = text((error as { message?: string })?.message) || assetsSyncError || 'Aims assets sync status update failed.'
  }

  return {
    code: 0,
    data: {
      project,
      environment,
      relation: syncUpdate?.relation || aimsUpsert.relation,
      assetsBind: syncResult.assetsBind,
      assetsLifecycle: syncResult.assetsLifecycle,
      assetsSyncStatus,
      assetsSyncError
    }
  }
})
