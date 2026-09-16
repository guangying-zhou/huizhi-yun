import { readBody } from 'h3'
import {
  parseNotificationDetailAuthorizationRequest,
  requireNotificationDetailAuthorizationCaller
} from '@hzy/foundation/server/utils/notificationDetailAuthorization'
import { maybeCallWorkflowDataRuntime, type WorkflowRuntimeEnvelope } from '~~/server/utils/dataRuntime'

interface AuthorizationResult {
  authorized: boolean
  reasonCode?: string
  resource: 'workflow_task' | 'workflow_instance'
  id: string
}

export default defineEventHandler(async (event) => {
  const request = parseNotificationDetailAuthorizationRequest(await readBody(event))
  const caller = await requireNotificationDetailAuthorizationCaller(event, request, {
    scope: 'workflow:notification-details:authorize'
  })

  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<AuthorizationResult>>(
    event,
    '/v1/workflow/notification-details/authorize',
    {
      scope: 'workflow.read',
      method: 'POST',
      body: {
        descriptor: request.descriptor,
        current_user: caller.subjectUid
      }
    }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) {
    throw createError({ statusCode: 503, message: 'Workflow notification authorization is unavailable.' })
  }

  return { code: 0, data: runtime.data.data }
})
