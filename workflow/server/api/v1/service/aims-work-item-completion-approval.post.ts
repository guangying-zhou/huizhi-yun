import { createError, getHeader, getRequestURL, readBody } from 'h3'
import { collectWorkflowInitiatorContext } from '~~/server/utils/initiatorContext'
import { ensureWorkflowConsoleAuth } from '~~/server/utils/authIdentity'
import { maybeCallWorkflowDataRuntime, runWorkflowRuntimeEffects, type WorkflowRuntimeEnvelope } from '~~/server/utils/dataRuntime'

import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders, type SignedServiceCommandEnvelope } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

type Row = Record<string, unknown>

function scopesOf(auth: Row) {
  return new Set([...(Array.isArray(auth.scopes) ? auth.scopes.map(String) : []), ...String((auth.claims as Row | undefined)?.scope || '').split(/\s+/).filter(Boolean)])
}

export default defineEventHandler(async (event) => {
  const auth = await ensureWorkflowConsoleAuth(event) as Row
  const sourceApp = String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/u, '')
  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') throw createError({ statusCode: 401, message: 'Console service token is required.' })
  if (sourceApp !== 'aims' || !scopesOf(auth).has('workflow:work-item-complete:create')) throw createError({ statusCode: 403, message: 'Aims work-item completion Workflow capability is required.' })
  const body = (await readBody<Row>(event)) || {}
  const command = body.serviceCommand as SignedServiceCommandEnvelope | undefined
  const actorUid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  if (!actorUid || String((command?.command as Row | undefined)?.actorUid || '').trim() !== actorUid) throw createError({ statusCode: 403, message: 'Trusted Aims actor delegation must match the frozen command.' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const tenantCode = String(auth.tenant || '')
  const sourceDeploymentCode = String(auth.deployment || '')
  if (auth.clientCode !== 'aims.runtime' || !tenantCode || !sourceDeploymentCode || !gateway || gateway.tenant !== tenantCode || gateway.appCode !== 'workflow' || !gateway.deployment) throw createError({ statusCode: 403, message: 'Completion service deployment binding is invalid.' })
  if (!command || command.targetApp !== 'workflow' || command.operationCode !== 'aims.work-item.completion.workflow-submit.v1' || command.requiredCapability !== 'workflow:work-item-complete:create' || command.commandSchemaVersion !== 'v1' || command.commandSha256 !== await hashServiceCommandPayload(command.command)) throw createError({ statusCode: 403, message: 'Completion signed command is invalid.' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: 'Completion service token is missing.' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname,
    requestId: getHeader(event, 'x-request-id') || '', tenantCode,
    sourceDeploymentCode, targetDeploymentCode: gateway.deployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'workflow',
    envelope: command, readHeader: name => getHeader(event, name)
  })
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<Row>>(event, '/v1/workflow/service/aims-work-item-completion-approval', {
    scope: 'workflow:work-item-complete:create', method: 'POST', body: { ...body, current_user: actorUid, initiator_context: await collectWorkflowInitiatorContext(event, actorUid) }, serviceCommandActor: { uid: actorUid }
  })
  if (!runtime.handled || runtime.data.code !== 0) throw createError({ statusCode: 503, message: 'Workflow Aims completion receipt is unavailable.' })
  const result = runtime.data.data?.result as Row | undefined
  return { code: 0, data: runtime.data.data, effect_results: await runWorkflowRuntimeEffects(event, result?.effects as never) }
})

