import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'

type PeopleInstanceConflictTargetType = 'assignment'
type PeopleInstanceConflictAction = 'approve'

interface PeopleInstanceConflictInput {
  targetType: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
}

interface RuntimeEnvelope<T> {
  data?: T
}

interface PeopleInstanceConflictTarget {
  targetType: PeopleInstanceConflictTargetType
  resourceCode: string
  defaultAction: PeopleInstanceConflictAction
  detailPath: (id: string) => string
}

export interface PeopleInstanceConflictExplanation {
  targetType: PeopleInstanceConflictTargetType
  id: string
  code: string | null
  action: PeopleInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplainResult
}

const peopleConflictTargets: Record<PeopleInstanceConflictTargetType, PeopleInstanceConflictTarget> = {
  assignment: {
    targetType: 'assignment',
    resourceCode: 'assignments',
    defaultAction: 'approve',
    detailPath: id => `/v1/people/assignments/${encodeURIComponent(id)}`
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function targetConfig(value: unknown): PeopleInstanceConflictTarget {
  const targetType = stringValue(value) as PeopleInstanceConflictTargetType
  const config = peopleConflictTargets[targetType]
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'targetType must be assignment'
    })
  }
  return config
}

function actionValue(value: unknown, fallback: PeopleInstanceConflictAction): PeopleInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'approve') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve'
  })
}

function assignmentCode(id: string, row: Record<string, unknown>) {
  return stringValue(row.assignment_code || row.assignmentCode || row.code) || id
}

function assignmentOperatorUid(row: Record<string, unknown>) {
  return stringValue(row.created_by || row.createdBy || row.operator_uid || row.operatorUid || row.updated_by || row.updatedBy)
}

function assignmentEmployeeUid(row: Record<string, unknown>) {
  return stringValue(row.employee_uid || row.employeeUid)
}

export function buildPeopleInstanceConflictObject(
  uid: string,
  id: string,
  row: Record<string, unknown>
) {
  const code = assignmentCode(id, row)
  return {
    actorUid: uid,
    ownerUid: assignmentOperatorUid(row) || assignmentEmployeeUid(row) || null,
    departmentCode: stringValue(row.dept_code || row.deptCode) || null,
    projectCode: null,
    matchedRelations: [
      `people:assignment:${code}`
    ]
  }
}

export function buildPeopleInstanceConflictPrincipals(row: Record<string, unknown>) {
  const principals: Array<{ kind: string, uid: string }> = []
  const operatorUid = assignmentOperatorUid(row)
  const employeeUid = assignmentEmployeeUid(row)
  if (operatorUid) {
    principals.push({ kind: 'requester', uid: operatorUid })
    principals.push({ kind: 'operator', uid: operatorUid })
  }
  if (employeeUid && employeeUid !== operatorUid) {
    principals.push({ kind: 'employee', uid: employeeUid })
  }
  return principals
}

async function loadPeopleConflictTargetRow(
  event: H3Event,
  target: PeopleInstanceConflictTarget,
  id: string
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    target.detailPath(id),
    {
      appCode,
      scope: 'people.read',
      method: 'GET'
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'People Runtime Unavailable',
      message: 'People tenant-runtime is required for instance conflict explanation.'
    })
  }

  if (!runtime.data.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'People target object not found.'
    })
  }

  return runtime.data.data
}

export async function explainPeopleInstanceConflicts(
  event: H3Event,
  uid: string,
  input: PeopleInstanceConflictInput
): Promise<PeopleInstanceConflictExplanation> {
  const target = targetConfig(input.targetType)
  const id = stringValue(input.id || input.code)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const action = actionValue(input.action, target.defaultAction)
  const row = await loadPeopleConflictTargetRow(event, target, id)
  const principals = buildPeopleInstanceConflictPrincipals(row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    activeRoleCode: stringValue(input.activeRoleCode) || undefined,
    authorizationMode: stringValue(input.authorizationMode) || undefined,
    resourceCode: target.resourceCode,
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: buildPeopleInstanceConflictObject(uid, id, row),
    principals
  })

  return {
    targetType: target.targetType,
    id,
    code: assignmentCode(id, row),
    action,
    principals,
    explanation
  }
}
