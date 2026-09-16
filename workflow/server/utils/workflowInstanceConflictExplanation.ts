import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'
import { ensureWorkflowConsoleAuth, requireRequestUid } from '~~/server/utils/authIdentity'
import {
  maybeCallWorkflowDataRuntime,
  type WorkflowRuntimeEnvelope
} from '~~/server/utils/dataRuntime'

type WorkflowInstanceConflictAction = 'approve' | 'reject' | 'delegate'

interface WorkflowInstanceConflictInput {
  taskId?: unknown
  action?: unknown
  includeBaseline?: unknown
}

interface WorkflowTaskInfo {
  id: number
  instance_id: number
  assignee_uid: string
  status: string
}

interface WorkflowInstanceInfo {
  id: number
  instance_no: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title?: string | null
  initiator_uid: string
}

interface WorkflowTaskDetail {
  task: WorkflowTaskInfo
  instance: WorkflowInstanceInfo
}

export interface WorkflowInstanceConflictExplanation {
  targetType: 'task'
  taskId: string
  instanceId: string
  instanceNo: string
  action: WorkflowInstanceConflictAction
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

function actionValue(value: unknown): WorkflowInstanceConflictAction {
  const action = stringValue(value || 'approve').toLowerCase()
  if (action === 'approve' || action === 'reject' || action === 'delegate') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve, reject or delegate'
  })
}

function workflowPrincipals(detail: WorkflowTaskDetail) {
  const principals: Array<{ kind: string, uid: string }> = []
  const initiatorUid = stringValue(detail.instance?.initiator_uid)
  const assigneeUid = stringValue(detail.task?.assignee_uid)

  if (initiatorUid) principals.push({ kind: 'initiator', uid: initiatorUid })
  if (assigneeUid && assigneeUid !== initiatorUid) principals.push({ kind: 'assignee', uid: assigneeUid })
  return principals
}

function workflowObjectContext(uid: string, detail: WorkflowTaskDetail) {
  return {
    actorUid: uid,
    ownerUid: stringValue(detail.instance?.initiator_uid) || null,
    workflowTaskId: String(detail.task?.id || ''),
    workflowInstanceId: String(detail.instance?.id || ''),
    workflowInstanceNo: stringValue(detail.instance?.instance_no) || null,
    resourceCode: stringValue(detail.instance?.resource_code) || null,
    actionCode: stringValue(detail.instance?.action_code) || null,
    bizId: stringValue(detail.instance?.biz_id) || null,
    matchedRelations: [
      `workflow:task:${detail.task?.id || ''}`,
      `workflow:instance:${detail.instance?.instance_no || detail.instance?.id || ''}`
    ].filter(Boolean)
  }
}

export async function loadWorkflowTaskConflictDetail(event: H3Event, taskId: unknown, uid = requireRequestUid(event)) {
  const id = stringValue(taskId)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'taskId is required' })
  }

  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<WorkflowTaskDetail>>(
    event,
    `/v1/workflow/tasks/${encodeURIComponent(id)}`,
    {
      scope: 'workflow.read',
      method: 'GET',
      query: {
        current_user: uid
      }
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Workflow Runtime Unavailable',
      message: 'Workflow tenant-runtime is required for instance conflict explanation.'
    })
  }
  if (!runtime.data.data?.task || !runtime.data.data.instance) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Workflow task conflict target not found.'
    })
  }

  return runtime.data.data
}

export async function explainWorkflowInstanceConflicts(
  event: H3Event,
  input: WorkflowInstanceConflictInput,
  detail?: WorkflowTaskDetail
): Promise<WorkflowInstanceConflictExplanation> {
  await ensureWorkflowConsoleAuth(event)
  const uid = requireRequestUid(event)
  const action = actionValue(input.action)
  const resolvedDetail = detail || await loadWorkflowTaskConflictDetail(event, input.taskId, uid)
  const principals = workflowPrincipals(resolvedDetail)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: 'workflow_tasks',
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: workflowObjectContext(uid, resolvedDetail),
    principals
  })

  return {
    targetType: 'task',
    taskId: String(resolvedDetail.task.id),
    instanceId: String(resolvedDetail.instance.id),
    instanceNo: resolvedDetail.instance.instance_no,
    action,
    principals,
    explanation,
    title: resolvedDetail.instance.biz_title || resolvedDetail.instance.instance_no || null
  }
}
