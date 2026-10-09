import { createError, type H3Event } from 'h3'
import {
  buildScopedAuthorizationGrantsFromPolicyBundle
} from '@hzy/foundation/server/utils/applicationAuthorization'
import {
  explainPolicyBundleInstanceConflicts
} from '@hzy/foundation/server/utils/instanceConflictExplanation'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { loadPolicyAuthorizationSnapshot } from '~~/server/utils/policyAuthorization'
import { loadPlatformRuntimeConfig } from '~~/server/utils/platformRuntime'

export interface PlatformInstancePrincipalInput {
  kind: string
  uid?: string | null
}

export interface PlatformInstanceConflictExplainInput {
  uid: string
  appCode: string
  resourceCode: string
  action: string
  activeRoleCode?: string | null
  authorizationMode?: string | null
  includeBaseline?: boolean
  object?: Record<string, unknown> | null
  principals?: PlatformInstancePrincipalInput[]
}

export interface PlatformInstanceConflictExplainResult {
  tenantCode: string
  uid: string
  requested: {
    appCode: string
    resourceCode: string
    action: string
  }
  principals: Array<{
    kind: string
    uid: string
    matchesActor: boolean
  }>
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: Array<Record<string, unknown>>
}

interface PlatformInstanceConflictEnvelope {
  success?: boolean
  code?: number
  data?: PlatformInstanceConflictExplainResult
  message?: string
}

type PlatformConflictFetch = (
  url: string,
  options: {
    method: 'POST'
    headers: { 'Authorization': string, 'x-hzy-internal-principal': string }
    body: Record<string, unknown>
    timeout: number
  }
) => Promise<PlatformInstanceConflictEnvelope>

function text(value: unknown) {
  return String(value || '').trim()
}

function isSuccessfulEnvelope(response: PlatformInstanceConflictEnvelope) {
  return response.success === true || response.code === 0
}

function hasBundleConflictRules(payload: Record<string, unknown> | null | undefined) {
  return Array.isArray(payload?.conflictRules)
    && payload.conflictRules.some((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false
      const record = rule as Record<string, unknown>
      const status = text(record.status) || 'active'
      return status === 'active'
        && text(record.ruleCode)
        && text(record.leftAppCode)
        && text(record.leftResourceCode)
        && text(record.leftAction)
        && text(record.rightAppCode)
        && text(record.rightResourceCode)
        && text(record.rightAction)
    })
}

async function explainLocalPolicyBundleInstanceConflicts(
  event: H3Event,
  input: Required<Pick<PlatformInstanceConflictExplainInput, 'uid' | 'appCode' | 'resourceCode' | 'action'>>
    & Pick<PlatformInstanceConflictExplainInput, 'activeRoleCode' | 'authorizationMode' | 'includeBaseline' | 'object' | 'principals'>,
  tenantCode: string
) {
  const authorizationMode = text(input.authorizationMode)
  const snapshot = await loadPolicyAuthorizationSnapshot(input.uid, input.appCode, event, {
    activeRoleCode: text(input.activeRoleCode) || undefined,
    authorizationMode: authorizationMode || undefined,
    allowRoleSimulation: authorizationMode === 'role_simulation',
    allowUserSimulation: authorizationMode === 'user_simulation',
    allowPrivileged: authorizationMode === 'privileged'
  })
  const payload = snapshot.payload || {}
  if (!hasBundleConflictRules(payload)) return null

  const grantResult = buildScopedAuthorizationGrantsFromPolicyBundle({
    payload,
    uid: snapshot.uid,
    requestedRoleCode: snapshot.activeRoleCode,
    authorizationMode: snapshot.authorizationMode,
    allowRoleSimulation: snapshot.authorizationMode === 'role_simulation',
    allowUserSimulation: snapshot.authorizationMode === 'user_simulation',
    allowPrivileged: snapshot.authorizationMode === 'privileged',
    includeBaseline: input.includeBaseline ?? snapshot.includeBaseline
  })

  return explainPolicyBundleInstanceConflicts({
    tenantCode,
    uid: snapshot.uid,
    appCode: input.appCode,
    resourceCode: input.resourceCode,
    action: input.action,
    payload,
    grants: grantResult.grants,
    object: input.object || undefined,
    principals: input.principals || []
  })
}

export async function explainPlatformInstanceConflicts(
  event: H3Event,
  input: PlatformInstanceConflictExplainInput
) {
  const uid = text(input.uid)
  if (!uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }

  const appCode = text(input.appCode)
  const resourceCode = text(input.resourceCode)
  const action = text(input.action)
  if (!appCode || !resourceCode || !action) {
    throw createError({ statusCode: 400, message: 'appCode, resourceCode and action are required' })
  }

  const config = loadPlatformRuntimeConfig(event)
  const normalizedInput = {
    uid,
    appCode,
    resourceCode,
    action,
    activeRoleCode: text(input.activeRoleCode) || undefined,
    authorizationMode: text(input.authorizationMode) || undefined,
    includeBaseline: input.includeBaseline ?? true,
    object: input.object || undefined,
    principals: input.principals || []
  }
  const localResult = await explainLocalPolicyBundleInstanceConflicts(event, normalizedInput, config.tenantCode)
    .catch((error) => {
      console.warn('[instance-conflict] local policy bundle explanation failed; falling back to Platform:', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    })
  if (localResult) return localResult

  const fetchPlatform = fetchExternal as unknown as PlatformConflictFetch
  const response = await fetchPlatform(
    `${config.baseUrl}/api/platform/internal/authorization/instance-conflict-explain`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.platformServiceToken}`,
        'x-hzy-internal-principal': 'console-authorization-runtime'
      },
      body: {
        tenantCode: config.tenantCode,
        ...normalizedInput
      },
      timeout: 10000
    }
  )

  if (!isSuccessfulEnvelope(response)) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Platform instance conflict explanation API returned an error.'
    })
  }

  if (!response.data) {
    throw createError({ statusCode: 502, message: 'Platform instance conflict explanation API returned empty data.' })
  }

  return response.data
}
