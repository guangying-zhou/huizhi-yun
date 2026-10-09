import {
  resolvePeopleDirectoryEmploymentProjection,
  type PeopleDirectoryEmploymentProjection
} from './peopleDirectoryProjection'
import {
  resolvePeopleOffboardingProjection,
  type PeopleOffboardingProjection
} from './peopleOffboardingProjection'

export interface NormalizedPeopleWorkflowCallback {
  body: Record<string, unknown>
  bizType: string
  bizId: string
  status: string
  workflowInstanceId: string
  operatorUid: string
}

export interface PeopleWorkflowLifecycleProjection {
  employment: PeopleDirectoryEmploymentProjection | null
  offboarding: PeopleOffboardingProjection | null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function pickString(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

export function normalizePeopleWorkflowStatus(value: unknown) {
  const status = text(value).toLowerCase()
  switch (status) {
    case 'pass':
    case 'passed':
    case 'approve':
    case 'approved':
    case 'success':
      return 'approved'
    case 'reject':
    case 'rejected':
    case 'failed':
      return 'rejected'
    case 'cancel':
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return status
  }
}

export function normalizePeopleWorkflowCallbackBody(rawBody: unknown): NormalizedPeopleWorkflowCallback {
  const body = objectBody(rawBody)
  const bizType = pickString(body, 'biz_type', 'bizType', 'resource_code', 'resourceCode')
  const bizId = pickString(body, 'biz_id', 'bizId', 'businessKey')
  const status = normalizePeopleWorkflowStatus(pickString(body, 'status', 'approval_status', 'approvalStatus', 'result'))
  const workflowInstanceId = pickString(body, 'workflow_instance_id', 'workflowInstanceId', 'instance_id', 'instanceId')
  const operatorUid = pickString(body, 'approval_operator_uid', 'operator_uid', 'operatorUid', 'updated_by', 'updatedBy')

  return {
    body: {
      ...body,
      biz_type: bizType,
      biz_id: bizId,
      status,
      workflow_instance_id: workflowInstanceId
    },
    bizType,
    bizId,
    status,
    workflowInstanceId,
    operatorUid
  }
}

export function isPeopleAssignmentWorkflowBizType(value: unknown) {
  return ['assignment', 'assignments', 'people_assignment'].includes(text(value).toLowerCase())
}

export function resolvePeopleWorkflowLifecycleProjection(
  callback: NormalizedPeopleWorkflowCallback,
  assignment: unknown
): PeopleWorkflowLifecycleProjection {
  if (callback.status !== 'approved' || !isPeopleAssignmentWorkflowBizType(callback.bizType)) {
    return { employment: null, offboarding: null }
  }

  const row = objectBody(assignment)
  const body = {
    ...row,
    operator_uid: callback.operatorUid || pickString(row, 'updated_by', 'updatedBy', 'created_by', 'createdBy')
  }

  return {
    employment: resolvePeopleDirectoryEmploymentProjection('/assignments', 'POST', body),
    offboarding: resolvePeopleOffboardingProjection('/assignments', 'POST', body)
  }
}
