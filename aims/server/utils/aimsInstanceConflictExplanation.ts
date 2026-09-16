import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

export type AimsInstanceConflictTargetType = 'approval' | 'requirement_review'
export type AimsInstanceConflictAction = 'approve' | 'confirm'

interface AimsInstanceConflictInput {
  targetType: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

interface RuntimeEnvelope<T> {
  data?: T
}

export interface AimsInstanceConflictPrincipal {
  kind: string
  uid: string
}

export interface AimsInstanceConflictFacts {
  targetType: AimsInstanceConflictTargetType
  id: number
  code?: string | null
  resourceCode: string
  action: AimsInstanceConflictAction
  principals: AimsInstanceConflictPrincipal[]
  object: Record<string, unknown>
  title?: string | null
}

export interface AimsInstanceConflictExplanation {
  targetType: AimsInstanceConflictTargetType
  id: string
  code: string | null
  action: AimsInstanceConflictAction
  principals: AimsInstanceConflictPrincipal[]
  explanation: RuntimeInstanceConflictExplainResult
  title?: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function targetTypeValue(value: unknown): AimsInstanceConflictTargetType {
  const targetType = stringValue(value) as AimsInstanceConflictTargetType
  if (targetType === 'approval' || targetType === 'requirement_review') return targetType
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'targetType must be approval or requirement_review'
  })
}

function actionValue(value: unknown, fallback: AimsInstanceConflictAction): AimsInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'approve' || action === 'confirm') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve or confirm'
  })
}

export async function loadAimsInstanceConflictFacts(
  event: H3Event,
  input: AimsInstanceConflictInput,
  uid = requireRequestUid(event)
): Promise<AimsInstanceConflictFacts> {
  const targetType = targetTypeValue(input.targetType)
  const id = stringValue(input.id || input.code)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: {
      target_type: targetType,
      id
    }
  })
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<AimsInstanceConflictFacts>>(
    event,
    '/v1/aims/authorization/instance-conflict-facts',
    {
      appCode,
      scope: 'aims.read',
      method: 'GET',
      query: runtimeQuery
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Aims Runtime Unavailable',
      message: 'Aims tenant-runtime is required for instance conflict explanation.'
    })
  }
  if (!runtime.data.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Aims conflict target object not found.'
    })
  }

  return runtime.data.data
}

export async function explainAimsInstanceConflicts(
  event: H3Event,
  input: AimsInstanceConflictInput,
  facts?: AimsInstanceConflictFacts
): Promise<AimsInstanceConflictExplanation> {
  const uid = requireRequestUid(event)
  const resolvedFacts = facts || await loadAimsInstanceConflictFacts(event, input, uid)
  const action = actionValue(input.action, resolvedFacts.action)
  if (action !== resolvedFacts.action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'action does not match target conflict permission'
    })
  }

  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: resolvedFacts.resourceCode,
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: {
      ...(resolvedFacts.object || {}),
      actorUid: uid
    },
    principals: resolvedFacts.principals || []
  })

  return {
    targetType: resolvedFacts.targetType,
    id: String(resolvedFacts.id),
    code: resolvedFacts.code || null,
    action,
    principals: resolvedFacts.principals || [],
    explanation,
    title: resolvedFacts.title || null
  }
}
