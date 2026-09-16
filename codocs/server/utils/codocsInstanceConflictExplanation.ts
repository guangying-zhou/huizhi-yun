import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { maybeCallCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export type CodocsInstanceConflictTargetType = 'review'
export type CodocsInstanceConflictAction = 'approve' | 'archive'

interface CodocsInstanceConflictInput {
  targetType: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export interface CodocsInstanceConflictExplanation {
  targetType: CodocsInstanceConflictTargetType
  id: string
  code: string | null
  action: CodocsInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
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

function targetTypeValue(value: unknown): CodocsInstanceConflictTargetType {
  const targetType = stringValue(value) as CodocsInstanceConflictTargetType
  if (targetType === 'review') return targetType
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'targetType must be review'
  })
}

function actionValue(value: unknown, fallback: CodocsInstanceConflictAction): CodocsInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'approve' || action === 'archive') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve or archive'
  })
}

function initiatorUid(row: Record<string, unknown>) {
  return stringValue(row.initiator_uid || row.initiatorUid || row.submitter_uid || row.submitterUid || row.created_by || row.createdBy)
}

function targetCode(id: string, row: Record<string, unknown>) {
  return stringValue(row.document_uuid || row.documentUuid || row.uuid || row.document_id || row.documentId) || id
}

function targetTitle(row: Record<string, unknown>) {
  return stringValue(row.document_title || row.documentTitle || row.source_title || row.sourceTitle || row.title) || null
}

function departmentCode(row: Record<string, unknown>) {
  return stringValue(row.dept_code || row.deptCode || row.department_code || row.departmentCode) || null
}

function projectCode(row: Record<string, unknown>) {
  return stringValue(row.project_code || row.projectCode) || null
}

function buildCodocsInstanceConflictPrincipals(row: Record<string, unknown>) {
  const uid = initiatorUid(row)
  if (!uid) return []
  return [
    { kind: 'requester', uid },
    { kind: 'initiator', uid },
    { kind: 'submitter', uid }
  ]
}

function buildCodocsInstanceConflictObject(
  uid: string,
  id: string,
  row: Record<string, unknown>
) {
  const code = targetCode(id, row)
  const documentUuid = stringValue(row.document_uuid || row.documentUuid)
  const category = stringValue(row.target_category || row.targetCategory)
  const matchedRelations = [
    `codocs:review:${id}`
  ]
  if (documentUuid) matchedRelations.push(`codocs:document:${documentUuid}`)
  if (category) matchedRelations.push(`codocs:category:${category}`)

  return {
    actorUid: uid,
    ownerUid: initiatorUid(row) || null,
    documentUuid: documentUuid || null,
    targetCategory: category || null,
    departmentCode: departmentCode(row),
    projectCode: projectCode(row),
    matchedRelations,
    objectCode: code
  }
}

async function loadCodocsReviewRow(event: H3Event, id: string) {
  const runtime = await maybeCallCodocsTenantRuntime<Record<string, unknown>>(
    event,
    `/v1/codocs/reviews/${encodeURIComponent(id)}`,
    { scope: 'codocs.read' }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Codocs Runtime Unavailable',
      message: 'Codocs tenant-runtime is required for instance conflict explanation.'
    })
  }

  if (!runtime.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Codocs review not found.'
    })
  }

  return runtime.data
}

export async function explainCodocsInstanceConflicts(
  event: H3Event,
  input: CodocsInstanceConflictInput
): Promise<CodocsInstanceConflictExplanation> {
  const uid = requireRequestUid(event)
  const targetType = targetTypeValue(input.targetType)
  const id = stringValue(input.id || input.code)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const row = await loadCodocsReviewRow(event, id)
  const action = actionValue(input.action, 'approve')
  const principals = buildCodocsInstanceConflictPrincipals(row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: 'reviews',
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: buildCodocsInstanceConflictObject(uid, id, row),
    principals
  })

  return {
    targetType,
    id,
    code: targetCode(id, row),
    action,
    principals,
    explanation,
    title: targetTitle(row)
  }
}
