import { createError, getQuery, getRequestURL, readBody } from 'h3'
import { collectInitiatorContext } from '~~/server/utils/flowEngine'
import { getDirectoryUserByUid } from '~~/server/utils/directoryRuntimeClient'
import { ensureWorkflowConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import {
  maybeCallWorkflowDataRuntime,
  runWorkflowRuntimeEffects,
  type WorkflowRuntimeEnvelope
} from '~~/server/utils/dataRuntime'
import { resolveWorkflowRoutePermission } from '~~/server/utils/workflowPermissionRoutes'

const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const pathname = getRequestURL(event).pathname
  const suffix = workflowApiSuffix(pathname)
  if (suffix === null) return

  if (!shouldForwardWorkflowRuntime(method, suffix)) return

  await ensureWorkflowConsoleAuth(event)
  const currentUser = getRequestUid(event) || ''
  if (method !== 'GET' && !currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const routePermission = resolveWorkflowRoutePermission(suffix, method)
  if (routePermission) {
    await requirePermission(event, routePermission.resource, routePermission.action)
  }

  const query = {
    ...getQuery(event),
    ...(currentUser ? { current_user: currentUser } : {})
  }
  let body: Record<string, unknown> | undefined
  if (method !== 'GET') {
    const rawBody = await readBody<Record<string, unknown>>(event)
    body = {
      ...(rawBody || {}),
      current_user: currentUser,
      ...(await delegateContextFor(suffix, rawBody || {})),
      ...(await initiatorContextFor(method, suffix, currentUser))
    }
  }

  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(event, `/v1/workflow${suffix}`, {
    scope: method === 'GET' ? 'workflow.read' : 'workflow.write',
    method,
    query,
    body
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Workflow tenant-runtime is required for /api/v1 data access.'
    })
  }

  await runWorkflowRuntimeEffects(event, runtime.data.effects)
  return {
    code: runtime.data.code,
    data: runtime.data.data
  }
})

function workflowApiSuffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return null

  const after = pathname[index + API_PREFIX.length] || ''
  if (after !== '' && after !== '/') return null

  return pathname.slice(index + API_PREFIX.length) || '/'
}

function shouldForwardWorkflowRuntime(method: string, suffix: string) {
  if (suffix === '/action-defs/sync') return false

  if (method === 'GET') {
    return suffix === '/actions'
      || suffix === '/tasks/pending'
      || suffix === '/tasks/done'
      || suffix === '/tasks/initiated'
      || /^\/tasks\/[^/]+$/.test(suffix)
      || suffix === '/instances/by-biz'
      || suffix === '/instances/by-biz-history'
      || /^\/instances\/[^/]+$/.test(suffix)
      || suffix === '/admin/action-defs'
      || suffix === '/admin/flow-schemas'
      || suffix === '/admin/flow-schemas/templates'
      || /^\/admin\/flow-schemas\/[^/]+$/.test(suffix)
      || suffix === '/admin/form-schemas'
      || /^\/admin\/form-schemas\/[^/]+$/.test(suffix)
      || suffix === '/admin/routes'
  }

  if (method === 'POST') {
    return suffix === '/instances'
      || suffix === '/instances/prepare'
      || /^\/instances\/[^/]+\/(cancel|resubmit)$/.test(suffix)
      || /^\/tasks\/[^/]+\/(approve|reject|delegate)$/.test(suffix)
      || suffix === '/admin/action-defs'
      || suffix === '/admin/flow-schemas'
      || suffix === '/admin/form-schemas'
      || suffix === '/admin/routes'
  }

  if (method === 'PATCH') {
    return /^\/admin\/(action-defs|flow-schemas|form-schemas|routes)\/[^/]+$/.test(suffix)
  }

  if (method === 'DELETE') {
    return /^\/admin\/(action-defs|flow-schemas|form-schemas|routes)\/[^/]+$/.test(suffix)
  }

  return false
}

async function initiatorContextFor(method: string, suffix: string, currentUser: string) {
  if (!currentUser || method !== 'POST') return {}
  if (
    suffix === '/instances'
    || suffix === '/instances/prepare'
    || /^\/instances\/[^/]+\/resubmit$/.test(suffix)
  ) {
    return { initiator_context: await collectInitiatorContext(currentUser) }
  }
  return {}
}

async function delegateContextFor(suffix: string, body: Record<string, unknown>) {
  if (!/^\/tasks\/[^/]+\/delegate$/.test(suffix)) return {}

  const delegateTo = String(body.delegate_to || '').trim()
  if (!delegateTo) {
    throw createError({ statusCode: 400, message: '被委托人 UID 必填' })
  }

  const delegateUser = await getDirectoryUserByUid(delegateTo)
  if (!delegateUser) {
    throw createError({ statusCode: 400, message: '被委托人不存在' })
  }

  return {
    delegate_name: delegateUser.realName || delegateUser.displayName || delegateTo
  }
}
