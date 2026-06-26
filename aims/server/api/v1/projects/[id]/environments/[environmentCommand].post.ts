import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { syncProjectEnvironmentAssets } from '~~/server/utils/projectEnvironmentAssetsSync'
import {
  normalizeProjectEnvironmentDeliveryStatus,
  projectEnvironmentRelationTypeValue
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

function boolFromAny(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = text(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return text(project[camel] ?? project[snake])
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

function parseEnvironmentCommand(value: string) {
  const normalized = text(value)
  const suffix = ':status'
  if (!normalized.endsWith(suffix)) {
    throw createError({ statusCode: 404, message: 'Unsupported project environment action.' })
  }
  const environmentCode = normalized.slice(0, -suffix.length)
  if (!environmentCode) {
    throw createError({ statusCode: 400, message: 'environmentCode is required.' })
  }
  return environmentCode
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

  const environmentCode = parseEnvironmentCommand(String(getRouterParam(event, 'environmentCommand') || ''))
  const body = objectBody(await readBody(event).catch(() => ({})))
  const deliveryStatus = firstText(body, 'deliveryStatus', 'delivery_status', 'status')
  if (!deliveryStatus) {
    throw createError({ statusCode: 400, message: 'deliveryStatus is required.' })
  }
  const normalizedDeliveryStatus = normalizeProjectEnvironmentDeliveryStatus(deliveryStatus)
  if (!normalizedDeliveryStatus) {
    throw createError({
      statusCode: 400,
      message: 'invalid project environment status',
      data: { code: 'invalid_environment_transition' }
    })
  }

  const project = await loadProject(event, projectId, uid)
  const projectCode = projectField(project, 'projectCode', 'project_code')
  const relationTypeInput = firstText(body, 'relationType', 'relation_type')
  const normalizedRelationType = projectEnvironmentRelationTypeValue(relationTypeInput, '')
  if (relationTypeInput && !normalizedRelationType) {
    throw createError({
      statusCode: 400,
      message: 'invalid project environment relationType',
      data: { code: 'invalid_environment_relation_type' }
    })
  }
  const deliveryAssetInput = firstText(body, 'deliveryAssetCode', 'delivery_asset_code')
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `aims:project-environment:${projectCode}:${environmentCode}:status:${normalizedDeliveryStatus}`

  const statusUpdate = await forwardAimsRuntimePost<ProjectEnvironmentResult>(
    event,
    `/v1/aims/service/projects/${encodeURIComponent(projectCode)}/environments/${encodeURIComponent(environmentCode)}:status`,
    {
      uid,
      body: {
        deliveryStatus: normalizedDeliveryStatus,
        deliveryAssetCode: deliveryAssetInput || undefined,
        relationType: normalizedRelationType || undefined,
        actualGoLiveAt: firstText(body, 'actualGoLiveAt', 'actual_go_live_at') || undefined,
        acceptedAt: firstText(body, 'acceptedAt', 'accepted_at') || undefined,
        handoverAt: firstText(body, 'handoverAt', 'handover_at') || undefined
      }
    }
  )

  const relation = statusUpdate.relation || {}
  const deliveryAssetCode = deliveryAssetInput || text(relation.delivery_asset_code)
  const relationType = normalizedRelationType || text(relation.relation_type) || 'initial_delivery'
  const deliveryVersionSnapshot = firstText(body, 'deliveryVersionSnapshot', 'delivery_version_snapshot', 'deployedVersion', 'deployed_version')
    || text(relation.delivery_version_snapshot)

  const syncResult = await syncProjectEnvironmentAssets(event, {
    idempotencyKey,
    projectCode,
    environmentCode,
    deliveryAssetCode,
    relationType,
    deliveryStatus: normalizedDeliveryStatus,
    isPrimary: boolFromAny(relation.is_primary),
    deliveryVersionSnapshot: deliveryVersionSnapshot || undefined,
    actualGoLiveAt: firstText(body, 'actualGoLiveAt', 'actual_go_live_at') || undefined,
    acceptedAt: firstText(body, 'acceptedAt', 'accepted_at') || undefined,
    operatorUid: uid,
    body
  })

  let syncUpdate: ProjectEnvironmentResult | null = null
  let assetsSyncStatus = syncResult.assetsSyncStatus
  let assetsSyncError = syncResult.assetsSyncError
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
      relation: syncUpdate?.relation || statusUpdate.relation,
      assetsBind: syncResult.assetsBind,
      assetsLifecycle: syncResult.assetsLifecycle,
      assetsSyncStatus,
      assetsSyncError
    }
  }
})
