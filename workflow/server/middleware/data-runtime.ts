import { createError, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { collectWorkflowInitiatorContext } from '~~/server/utils/initiatorContext'
import { getDirectoryUserByUid } from '~~/server/utils/directoryRuntimeClient'
import {
  ensureWorkflowConsoleAuth,
  getRequestUid,
  getTrustedWorkflowProxyActor
} from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import {
  maybeCallWorkflowDataRuntime,
  runWorkflowRuntimeEffects,
  type WorkflowRuntimeEnvelope
} from '~~/server/utils/dataRuntime'
import {
  resolveWorkflowProxyAuthorizationPurpose,
  resolveWorkflowRoutePermission
} from '~~/server/utils/workflowPermissionRoutes'
import { resolveWorkflowProjectDirectorRoleHolder } from '~~/server/utils/projectDirectorRoleHolder'

const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const pathname = getRequestURL(event).pathname
  const suffix = workflowApiSuffix(pathname)
  if (suffix === null) return

  if (!shouldForwardWorkflowRuntime(method, suffix)) return

  const consoleAuth = await ensureWorkflowConsoleAuth(event)
  const workflowProxyActor = getTrustedWorkflowProxyActor(event, consoleAuth)
  if (consoleAuth?.authenticated && consoleAuth.tokenUse === 'service' && !workflowProxyActor) {
    throw createError({ statusCode: 403, message: 'Trusted Workflow proxy source and actor delegation are required.' })
  }
  const currentUser = getRequestUid(event) || ''
  if (method !== 'GET' && !currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const routePermission = resolveWorkflowRoutePermission(suffix, method)
  if (routePermission) {
    if (workflowProxyActor) {
      const purpose = resolveWorkflowProxyAuthorizationPurpose(suffix, method)
      if (!purpose) {
        throw createError({ statusCode: 403, message: 'Workflow proxy route is not authorized.' })
      }
      const eligibility = await checkSubjectEligibility({
        event,
        subjectUid: workflowProxyActor.uid,
        purpose
      })
      if (!eligibility.allowed) {
        throw createError({ statusCode: 403, message: '当前用户无权执行此审批操作' })
      }
    } else {
      await requirePermission(event, routePermission.resource, routePermission.action)
    }
  }

  const query: Record<string, unknown> = {
    ...getQuery(event),
    ...(currentUser ? { current_user: currentUser } : {})
  }
  delete query.current_project_director_uid
  delete query.currentProjectDirectorUid
  delete query.current_project_director_revision
  delete query.currentProjectDirectorRevision
  delete query.current_project_director_display_name
  delete query.currentProjectDirectorDisplayName
  const reconcilesProjectDirector = needsProjectDirectorReconciliation(suffix, query)
  if (reconcilesProjectDirector) {
    const director = await resolveWorkflowProjectDirectorRoleHolder(event)
    query.current_project_director_uid = director.uid
    query.current_project_director_revision = String(director.revision)
    query.current_project_director_display_name = director.displayName
  }
  let body: Record<string, unknown> | undefined
  if (method !== 'GET') {
    const rawBody = await readBody<Record<string, unknown>>(event)
    body = {
      ...(rawBody || {}),
      current_user: currentUser,
      ...(await delegateContextFor(event, suffix, rawBody || {})),
      ...(await initiatorContextFor(event, method, suffix, currentUser))
    }
  }

  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope>(event, `/v1/workflow${suffix}`, {
    scope: method === 'GET' ? 'workflow.read' : 'workflow.write',
    method,
    query,
    body,
    ...(workflowProxyActor
      ? {
          workflowProxyActor: { uid: workflowProxyActor.uid },
          serviceTokenSourceBinding: 'service-client-policy' as const
        }
      : {})
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Workflow tenant-runtime is required for /api/v1 data access.'
    })
  }

  const effectResults = await runWorkflowRuntimeEffects(event, runtime.data.effects)
  // The request only delivers effects produced by this command. Global durable
  // outboxes are drained by the trusted scheduler endpoint so ordinary reads
  // never wait for unrelated cross-service delivery work.
  return {
    code: runtime.data.code,
    data: runtime.data.data,
    effect_results: {
      ...effectResults,
      outbox: [],
      callbackOutbox: []
    }
  }
})

function workflowApiSuffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return null

  const after = pathname[index + API_PREFIX.length] || ''
  if (after !== '' && after !== '/') return null

  return pathname.slice(index + API_PREFIX.length) || '/'
}

function needsProjectDirectorReconciliation(suffix: string, query: Record<string, unknown>) {
  if (suffix === '/instances/by-biz' || suffix === '/instances/by-biz-history') {
    const appCode = String(query.app_code || '').trim()
    const resourceCode = String(query.resource_code || '').trim()
    const actionCode = String(query.action_code || '').trim()
    return appCode === 'aims'
      && resourceCode === 'milestones'
      && (suffix === '/instances/by-biz-history' || actionCode === 'milestone_completion')
  }

  return suffix === '/tasks/pending'
    || /^\/tasks\/[^/]+$/.test(suffix)
    || /^\/tasks\/[^/]+\/(approve|reject|delegate)$/.test(suffix)
    || /^\/instances\/[^/]+$/.test(suffix)
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

async function initiatorContextFor(event: H3Event, method: string, suffix: string, currentUser: string) {
  if (!currentUser || method !== 'POST') return {}
  if (
    suffix === '/instances'
    || suffix === '/instances/prepare'
    || /^\/instances\/[^/]+\/resubmit$/.test(suffix)
  ) {
    return { initiator_context: await collectWorkflowInitiatorContext(event, currentUser) }
  }
  return {}
}

async function delegateContextFor(event: H3Event, suffix: string, body: Record<string, unknown>) {
  if (!/^\/tasks\/[^/]+\/delegate$/.test(suffix)) return {}

  const delegateTo = String(body.delegate_to || '').trim()
  if (!delegateTo) {
    throw createError({ statusCode: 400, message: '被委托人 UID 必填' })
  }

  const delegateUser = await getDirectoryUserByUid(event, delegateTo)
  if (!delegateUser) {
    throw createError({ statusCode: 400, message: '被委托人不存在' })
  }

  return {
    delegate_name: delegateUser.realName || delegateUser.displayName || delegateTo
  }
}
