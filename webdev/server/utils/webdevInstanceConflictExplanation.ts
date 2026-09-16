import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'
import { dataRuntimeFetch } from '~~/server/utils/dataRuntime'

type WebDevInstanceConflictTargetType = 'job'
type WebDevInstanceConflictAction = 'deploy'

interface WebDevInstanceConflictInput {
  targetType: unknown
  id?: unknown
  jobId?: unknown
  action?: unknown
  includeBaseline?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
}

interface RuntimeEnvelope<T> {
  data?: T
}

interface WebDevInstanceConflictTarget {
  targetType: WebDevInstanceConflictTargetType
  resourceCode: string
  defaultAction: WebDevInstanceConflictAction
  detailPath: (id: string) => string
}

export interface WebDevInstanceConflictExplanation {
  targetType: WebDevInstanceConflictTargetType
  id: string
  code: string | null
  action: WebDevInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplainResult
}

const webdevConflictTargets: Record<WebDevInstanceConflictTargetType, WebDevInstanceConflictTarget> = {
  job: {
    targetType: 'job',
    resourceCode: 'webdev_workspace',
    defaultAction: 'deploy',
    detailPath: id => `/v1/webdev/jobs/${encodeURIComponent(id)}`
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function targetConfig(value: unknown): WebDevInstanceConflictTarget {
  const targetType = stringValue(value) as WebDevInstanceConflictTargetType
  const config = webdevConflictTargets[targetType]
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'targetType must be job'
    })
  }
  return config
}

function actionValue(value: unknown, fallback: WebDevInstanceConflictAction): WebDevInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'deploy') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be deploy'
  })
}

function jobCode(id: string, row: Record<string, unknown>) {
  return stringValue(row.id || row.job_id || row.jobId || row.code) || id
}

function jobCreatorUid(row: Record<string, unknown>) {
  return stringValue(row.createdBy || row.created_by || row.creatorUid || row.creator_uid || row.requesterUid || row.requester_uid)
}

export function buildWebDevInstanceConflictObject(
  uid: string,
  id: string,
  row: Record<string, unknown>
) {
  const code = jobCode(id, row)
  const repoId = stringValue(row.repoId || row.repo_id)
  const projectId = stringValue(row.projectId || row.project_id)
  const matchedRelations = [
    `webdev:job:${code}`
  ]
  if (repoId) matchedRelations.push(`webdev:repo:${repoId}`)

  return {
    actorUid: uid,
    ownerUid: jobCreatorUid(row) || null,
    departmentCode: null,
    projectCode: projectId || null,
    matchedRelations
  }
}

export function buildWebDevInstanceConflictPrincipals(row: Record<string, unknown>) {
  const principals: Array<{ kind: string, uid: string }> = []
  const creatorUid = jobCreatorUid(row)
  if (creatorUid) {
    principals.push({ kind: 'requester', uid: creatorUid })
    principals.push({ kind: 'executor', uid: creatorUid })
  }
  return principals
}

async function loadWebDevConflictTargetRow(
  event: H3Event,
  target: WebDevInstanceConflictTarget,
  id: string
) {
  const runtime = await dataRuntimeFetch<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    target.detailPath(id)
  )

  if (!runtime.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'WebDev target object not found.'
    })
  }

  return runtime.data
}

export async function explainWebDevInstanceConflicts(
  event: H3Event,
  uid: string,
  input: WebDevInstanceConflictInput
): Promise<WebDevInstanceConflictExplanation> {
  const target = targetConfig(input.targetType)
  const id = stringValue(input.id || input.jobId)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const action = actionValue(input.action, target.defaultAction)
  const row = await loadWebDevConflictTargetRow(event, target, id)
  const principals = buildWebDevInstanceConflictPrincipals(row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    activeRoleCode: stringValue(input.activeRoleCode) || undefined,
    authorizationMode: stringValue(input.authorizationMode) || undefined,
    resourceCode: target.resourceCode,
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: buildWebDevInstanceConflictObject(uid, id, row),
    principals
  })

  return {
    targetType: target.targetType,
    id,
    code: jobCode(id, row),
    action,
    principals,
    explanation
  }
}
