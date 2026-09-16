import { getHeader, readBody } from 'h3'
import { requireCodocsServiceAuth, requireCodocsServiceTenantDeploymentBinding, WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH } from '~~/server/utils/serviceAuthGuard'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

type WorkflowCallback = { app_code?: unknown, resource_code?: unknown, biz_id?: unknown, instance_no?: unknown, status?: unknown }

function publishRequestId(value: unknown) {
  const matched = /^publish-request:(\d+)$/.exec(String(value || '').trim())
  return matched?.[1] || ''
}

export default defineEventHandler(async (event) => {
  requireCodocsServiceAuth(event.context.consoleAuth, WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH)
  requireCodocsServiceTenantDeploymentBinding(
    event.context.consoleAuth,
    getHeader(event, 'x-hzy-tenant'),
    getHeader(event, 'x-hzy-deployment')
  )
  const body = (await readBody<WorkflowCallback>(event)) || {}
  const requestId = publishRequestId(body.biz_id)
  if (body.app_code !== 'codocs' || body.resource_code !== 'documents' || !requestId) {
    throw createError({ statusCode: 403, message: 'Workflow callback does not target a Codocs publish request.' })
  }
  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/workflow-callback`, {
    method: 'POST', scope: 'codocs.write', body: { instanceNo: String(body.instance_no || '').trim(), status: String(body.status || '').trim() }
  })
  return { code: 0, data }
})
