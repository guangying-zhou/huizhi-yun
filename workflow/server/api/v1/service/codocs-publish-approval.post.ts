import { createError, getHeader, readBody } from 'h3'
import { collectWorkflowInitiatorContext } from '~~/server/utils/initiatorContext'
import { ensureWorkflowConsoleAuth } from '~~/server/utils/authIdentity'
import { maybeCallWorkflowDataRuntime, runWorkflowRuntimeEffects, type WorkflowRuntimeEnvelope } from '~~/server/utils/dataRuntime'

type Row = Record<string, unknown>

function scopesOf(auth: Row) {
  return new Set([...(Array.isArray(auth.scopes) ? auth.scopes.map(String) : []), ...String((auth.claims as Row | undefined)?.scope || '').split(/\s+/).filter(Boolean)])
}

export default defineEventHandler(async (event) => {
  const auth = await ensureWorkflowConsoleAuth(event) as Row
  const sourceApp = String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/u, '')
  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') throw createError({ statusCode: 401, message: 'Console service token is required.' })
  if (sourceApp !== 'codocs' || !scopesOf(auth).has('workflow:document-publish:create')) throw createError({ statusCode: 403, message: 'Codocs document publish Workflow capability is required.' })
  const body = (await readBody<Row>(event)) || {}
  const command = body.serviceCommand as Row | undefined
  const actorUid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  if (!actorUid || String((command?.command as Row | undefined)?.actorUid || '').trim() !== actorUid) throw createError({ statusCode: 403, message: 'Trusted Codocs actor delegation must match the frozen command.' })
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<Row>>(event, '/v1/workflow/service/codocs-publish-approval', {
    scope: 'workflow:document-publish:create', method: 'POST', body: { ...body, current_user: actorUid, initiator_context: await collectWorkflowInitiatorContext(event, actorUid) }, serviceCommandActor: { uid: actorUid }
  })
  if (!runtime.handled || runtime.data.code !== 0) throw createError({ statusCode: 503, message: 'Workflow Codocs publish receipt is unavailable.' })
  const result = runtime.data.data?.result as Row | undefined
  return { code: 0, data: runtime.data.data, effect_results: await runWorkflowRuntimeEffects(event, result?.effects as never) }
})
