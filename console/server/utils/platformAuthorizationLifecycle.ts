import { createError, type H3Event } from 'h3'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { loadPlatformRuntimeConfig } from '~~/server/utils/platformRuntime'

interface PlatformOffboardingEnvelope {
  success?: boolean
  code?: number
  data?: PlatformOffboardingResult
  message?: string
}

interface PlatformEmploymentAuthorizationEnvelope {
  success?: boolean
  code?: number
  data?: PlatformEmploymentAuthorizationResult
  message?: string
}

type PlatformLifecycleFetch = <T>(
  url: string,
  options: {
    method: 'POST'
    headers: { 'Authorization': string, 'x-hzy-internal-principal': string }
    body: Record<string, unknown>
    timeout: number
  }
) => Promise<T>

export interface PlatformOffboardingResult {
  tenantCode: string
  uid: string
  subjectFound: boolean
  subjectId?: number
  previousSubjectStatus?: string
  subjectDisabled: boolean
  revokedAssignments: number
  disabledAssignmentScopes: number
  disabledTemplateBindings: number
  disabledTemplateOverrides: number
  inactiveMemberships: number
  idempotencyKey?: string | null
}

export interface PlatformEmploymentAuthorizationResult {
  tenantCode: string
  uid: string
  subjectId: number
  subjectCreated: boolean
  subjectReactivated: boolean
  positionCode?: string | null
  positionName?: string | null
  roleMatched: boolean
  role?: {
    id: number
    roleCode: string
    roleName: string
    catalogCategory?: string | null
    catalogCategorySource?: string | null
  } | null
  sourceId?: string | null
  grantedAssignmentId: number
  revokedPositionAssignments: number
  metadataAvailable: boolean
  candidateCount: number
  idempotencyKey?: string | null
}

export interface ReclaimPlatformAuthorizationInput {
  uid: string
  sourceApp: string
  operatorUid?: string
  reason?: string
  idempotencyKey?: string
}

export interface SyncPlatformEmploymentAuthorizationInput {
  uid: string
  sourceApp: string
  positionCode?: string | null
  positionName?: string | null
  deptCode?: string | null
  operatorUid?: string
  reason?: string
  idempotencyKey?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

export async function reclaimPlatformUserAuthorizationForOffboarding(
  event: H3Event,
  input: ReclaimPlatformAuthorizationInput
) {
  const uid = text(input.uid)
  if (!uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }

  const config = loadPlatformRuntimeConfig(event)
  const fetchPlatform = fetchExternal as unknown as PlatformLifecycleFetch
  const response = await fetchPlatform<PlatformOffboardingEnvelope>(
    `${config.baseUrl}/api/platform/internal/authorization/users/${encodeURIComponent(uid)}/offboarding`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.platformServiceToken}`,
        'x-hzy-internal-principal': 'console-directory-runtime'
      },
      body: {
        tenantCode: config.tenantCode,
        sourceApp: text(input.sourceApp) || 'people',
        operatorUid: text(input.operatorUid) || null,
        reason: text(input.reason) || 'people_offboarding',
        idempotencyKey: text(input.idempotencyKey) || `people:employee:${uid}:platform-authorization-offboarding:v1`
      },
      timeout: 10000
    }
  )

  if (response.code !== 0 && response.success !== true) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Platform authorization offboarding API returned an error.'
    })
  }

  if (!response.data) {
    throw createError({ statusCode: 502, message: 'Platform authorization offboarding API returned empty data.' })
  }

  return response.data
}

export async function syncPlatformUserEmploymentAuthorization(
  event: H3Event,
  input: SyncPlatformEmploymentAuthorizationInput
) {
  const uid = text(input.uid)
  if (!uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }

  const config = loadPlatformRuntimeConfig(event)
  const idempotencyKey = text(input.idempotencyKey) || `people:employee:${uid}:platform-employment-authorization:v1`
  const fetchPlatform = fetchExternal as unknown as PlatformLifecycleFetch
  const response = await fetchPlatform<PlatformEmploymentAuthorizationEnvelope>(
    `${config.baseUrl}/api/platform/internal/authorization/users/${encodeURIComponent(uid)}/employment`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.platformServiceToken}`,
        'x-hzy-internal-principal': 'console-directory-runtime'
      },
      body: {
        tenantCode: config.tenantCode,
        sourceApp: text(input.sourceApp) || 'people',
        positionCode: text(input.positionCode),
        positionName: text(input.positionName),
        deptCode: text(input.deptCode),
        operatorUid: text(input.operatorUid),
        reason: text(input.reason) || 'people_employment_position_sync',
        idempotencyKey
      },
      timeout: 10000
    }
  )

  if (response.code !== 0 && response.success !== true) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Platform employment authorization API returned an error.'
    })
  }

  if (!response.data) {
    throw createError({ statusCode: 502, message: 'Platform employment authorization API returned empty data.' })
  }

  return response.data
}
