import { readBody } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import {
  explainWorkflowInstanceConflicts,
  loadWorkflowTaskConflictDetail
} from '~~/server/utils/workflowInstanceConflictExplanation'

interface WorkflowInstanceConflictExplainBody {
  taskId?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<WorkflowInstanceConflictExplainBody>(event)
    .catch(() => ({} as WorkflowInstanceConflictExplainBody))

  await requirePermission(event, 'workflow_tasks', 'view')
  const detail = await loadWorkflowTaskConflictDetail(event, body.taskId)
  const result = await explainWorkflowInstanceConflicts(event, {
    taskId: body.taskId,
    action: body.action,
    includeBaseline: body.includeBaseline
  }, detail)

  return {
    code: 0,
    data: result
  }
})
