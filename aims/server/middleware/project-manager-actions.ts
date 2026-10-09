import { createError, getRequestURL, readBody, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { getProjectContext } from '~~/server/utils/projectDocumentAccess'
import {
  getProjectInitiationApplicabilityIssue,
  getProjectInitiationRepositoryIssue
} from '~~/app/utils/projectInitiationPolicy'

const PROJECT_MANAGER_WORKFLOW_ACTIONS = new Set([
  'initiation',
  'pause',
  'resume',
  'finish'
])

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

async function ensureRequestUid(event: H3Event) {
  const existingAuth = event.context.consoleAuth as { authenticated?: unknown, reason?: unknown } | undefined
  if (!existingAuth || (!('authenticated' in existingAuth) && !('reason' in existingAuth))) {
    event.context.consoleAuth = await resolveConsoleAuthWithSessionBridge(event)
  }

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  return uid
}

function projectWorkflowRequest(body: Record<string, unknown>) {
  const formData = recordValue(body.form_data ?? body.formData)
  const bizContext = recordValue(body.biz_context ?? body.bizContext)

  const appCode = stringField(body, 'app_code', 'appCode')
    || stringField(formData, 'app_code', 'appCode')
    || stringField(bizContext, 'app_code', 'appCode')
  const resourceCode = stringField(body, 'resource_code', 'resourceCode')
    || stringField(formData, 'resource_code', 'resourceCode')
    || stringField(bizContext, 'resource_code', 'resourceCode')
  const actionCode = stringField(body, 'action_code', 'actionCode')
    || stringField(formData, 'action_code', 'actionCode')
    || stringField(bizContext, 'action_code', 'actionCode')
  const bizId = stringField(body, 'biz_id', 'bizId')
    || stringField(formData, 'project_id', 'projectId')
    || stringField(bizContext, 'project_id', 'projectId')

  if (appCode !== 'aims' || resourceCode !== 'projects' || !PROJECT_MANAGER_WORKFLOW_ACTIONS.has(actionCode)) {
    return null
  }

  const projectId = Number(bizId)
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目 ID' })
  }

  return {
    actionCode,
    projectId
  }
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (method !== 'POST') return
  if (url.pathname !== '/api/workflow-proxy/instances/prepare' && url.pathname !== '/api/workflow-proxy/instances') return

  const body = recordValue(await readBody(event).catch(() => ({})))
  const workflowRequest = projectWorkflowRequest(body)
  if (!workflowRequest) return

  const uid = await ensureRequestUid(event)
  const projectContext = await getProjectContext(event, workflowRequest.projectId, uid)
  if (!projectContext.isManager) {
    throw createError({ statusCode: 403, message: '仅项目经理可以发起项目生命周期审批' })
  }

  if (workflowRequest.actionCode === 'initiation') {
    const applicabilityIssue = getProjectInitiationApplicabilityIssue(projectContext.project)
    if (applicabilityIssue) {
      throw createError({ statusCode: 409, message: applicabilityIssue })
    }
    if (url.pathname === '/api/workflow-proxy/instances') {
      const repositoryIssue = getProjectInitiationRepositoryIssue(projectContext.project)
      if (repositoryIssue) {
        throw createError({ statusCode: 400, message: repositoryIssue })
      }
    }
  }
})
