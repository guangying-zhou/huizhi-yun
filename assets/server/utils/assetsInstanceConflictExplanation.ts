import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requireRequestUid } from '~~/server/utils/authIdentity'

type AssetsInstanceConflictTargetType = 'purchase_order' | 'assignment'
type AssetsInstanceConflictAction = 'approve'

interface AssetsInstanceConflictInput {
  targetType: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

interface RuntimeEnvelope<T> {
  data?: T
}

interface AssetsInstanceConflictTarget {
  targetType: AssetsInstanceConflictTargetType
  resourceCode: string
  defaultAction: AssetsInstanceConflictAction
  detailPath: (id: string) => string
}

export interface AssetsInstanceConflictExplanation {
  targetType: AssetsInstanceConflictTargetType
  id: string
  code: string | null
  action: AssetsInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplainResult
}

const assetsConflictTargets: Record<AssetsInstanceConflictTargetType, AssetsInstanceConflictTarget> = {
  purchase_order: {
    targetType: 'purchase_order',
    resourceCode: 'purchase_orders',
    defaultAction: 'approve',
    detailPath: id => `/v1/assets/purchase-orders/${encodeURIComponent(id)}`
  },
  assignment: {
    targetType: 'assignment',
    resourceCode: 'assignments',
    defaultAction: 'approve',
    detailPath: id => `/v1/assets/assignments/${encodeURIComponent(id)}`
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function targetConfig(value: unknown): AssetsInstanceConflictTarget {
  const targetType = stringValue(value) as AssetsInstanceConflictTargetType
  const config = assetsConflictTargets[targetType]
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'targetType must be purchase_order or assignment'
    })
  }
  return config
}

function actionValue(value: unknown, fallback: AssetsInstanceConflictAction): AssetsInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'approve') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve'
  })
}

function purchaseOrderPrincipalUid(row: Record<string, unknown>) {
  return stringValue(row.applicant_uid || row.applicantUid || row.requester_uid || row.requesterUid || row.created_by || row.createdBy)
}

function assignmentRequesterUid(row: Record<string, unknown>) {
  return stringValue(row.requested_by || row.requestedBy || row.operator_uid || row.operatorUid || row.created_by || row.createdBy)
}

function assignmentTargetUserUid(row: Record<string, unknown>) {
  const targetType = stringValue(row.target_type || row.targetType).toLowerCase()
  if (targetType !== 'user') return ''
  return stringValue(row.target_ref || row.targetRef)
}

function targetCode(target: AssetsInstanceConflictTarget, id: string, row: Record<string, unknown>) {
  if (target.targetType === 'purchase_order') return stringValue(row.order_no || row.orderNo || row.code) || id
  return stringValue(row.assignment_no || row.assignmentNo || row.code) || id
}

function ownerUidForTarget(target: AssetsInstanceConflictTarget, row: Record<string, unknown>) {
  if (target.targetType === 'purchase_order') return purchaseOrderPrincipalUid(row)
  return assignmentRequesterUid(row) || assignmentTargetUserUid(row)
}

export function buildAssetsInstanceConflictObject(
  uid: string,
  target: AssetsInstanceConflictTarget,
  id: string,
  row: Record<string, unknown>
) {
  const code = targetCode(target, id, row)
  const object = {
    actorUid: uid,
    ownerUid: ownerUidForTarget(target, row) || null,
    departmentCode: stringValue(row.applicant_dept_code || row.applicantDeptCode || row.department_code || row.departmentCode) || null,
    projectCode: stringValue(row.project_code || row.projectCode || (
      target.targetType === 'assignment' && stringValue(row.target_type || row.targetType).toLowerCase() === 'project'
        ? row.target_ref || row.targetRef
        : ''
    )) || null,
    matchedRelations: [
      `assets:${target.targetType}:${code}`
    ]
  }
  if (target.targetType === 'assignment') {
    return {
      ...object,
      assignedUid: assignmentTargetUserUid(row) || null
    }
  }
  return object
}

export function buildAssetsInstanceConflictPrincipals(
  target: AssetsInstanceConflictTarget,
  row: Record<string, unknown>
) {
  if (target.targetType === 'purchase_order') {
    const uid = purchaseOrderPrincipalUid(row)
    if (!uid) return []
    return [
      { kind: 'requester', uid },
      { kind: 'applicant', uid }
    ]
  }

  const principals: Array<{ kind: string, uid: string }> = []
  const requesterUid = assignmentRequesterUid(row)
  const targetUserUid = assignmentTargetUserUid(row)
  if (requesterUid) {
    principals.push({ kind: 'requester', uid: requesterUid })
    principals.push({ kind: 'operator', uid: requesterUid })
  }
  if (targetUserUid && targetUserUid !== requesterUid) {
    principals.push({ kind: 'target_user', uid: targetUserUid })
  }
  return principals
}

async function loadAssetsConflictTargetRow(
  event: H3Event,
  target: AssetsInstanceConflictTarget,
  id: string
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    target.detailPath(id),
    {
      appCode,
      scope: 'assets.read',
      method: 'GET',
      query: {
        current_user_assets_object_access: 'all',
        current_user_assets_permission_action: 'approve'
      }
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Assets Runtime Unavailable',
      message: 'Assets tenant-runtime is required for instance conflict explanation.'
    })
  }

  if (!runtime.data.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Assets target object not found.'
    })
  }

  return runtime.data.data
}

export async function explainAssetsInstanceConflicts(
  event: H3Event,
  input: AssetsInstanceConflictInput
): Promise<AssetsInstanceConflictExplanation> {
  const uid = requireRequestUid(event)
  const target = targetConfig(input.targetType)
  const id = stringValue(input.id || input.code)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const action = actionValue(input.action, target.defaultAction)
  const row = await loadAssetsConflictTargetRow(event, target, id)
  const principals = buildAssetsInstanceConflictPrincipals(target, row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: target.resourceCode,
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: buildAssetsInstanceConflictObject(uid, target, id, row),
    principals
  })

  return {
    targetType: target.targetType,
    id,
    code: targetCode(target, id, row),
    action,
    principals,
    explanation
  }
}
