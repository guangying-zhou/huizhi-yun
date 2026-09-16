import { createError, getHeader, readBody } from 'h3'
import { collectWorkflowInitiatorContext } from '~~/server/utils/initiatorContext'
import { ensureWorkflowConsoleAuth } from '~~/server/utils/authIdentity'
import { maybeCallWorkflowDataRuntime, runWorkflowRuntimeEffects, type WorkflowRuntimeEnvelope } from '~~/server/utils/dataRuntime'

type RuntimeRow = Record<string, unknown>

export default defineEventHandler(async (event) => {
  const auth = await ensureWorkflowConsoleAuth(event) as RuntimeRow
  const scopes = new Set([
    ...(Array.isArray(auth.scopes) ? auth.scopes.map(String) : []),
    ...String((auth.claims as RuntimeRow | undefined)?.scope || '').split(/\s+/).filter(Boolean)
  ])
  const sourceApp = String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/u, '')
  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (sourceApp !== 'finance' || !scopes.has('workflow:invoice-request:create')) {
    throw createError({ statusCode: 403, message: 'Finance invoice Workflow capability is required.' })
  }
  const body = (await readBody<RuntimeRow>(event)) || {}
  const actorUid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  const envelope = body.serviceCommand as RuntimeRow | undefined
  const frozenCommand = envelope?.command as RuntimeRow | undefined
  if (!actorUid || String(frozenCommand?.actorUid || '').trim() !== actorUid) {
    throw createError({ statusCode: 403, message: 'Trusted Finance actor delegation must match the frozen command.' })
  }
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowRuntimeEnvelope<RuntimeRow>>(
    event,
    '/v1/workflow/service/finance-invoice-approval',
    {
      scope: 'workflow:invoice-request:create',
      method: 'POST',
      body: {
        ...body,
        current_user: actorUid,
        initiator_context: await collectWorkflowInitiatorContext(event, actorUid)
      },
      serviceCommandActor: { uid: actorUid }
    }
  )
  if (!runtime.handled || runtime.data.code !== 0) {
    throw createError({ statusCode: 503, message: 'Workflow invoice approval receipt is unavailable.' })
  }
  const result = runtime.data.data?.result as RuntimeRow | undefined
  const effectResults = await runWorkflowRuntimeEffects(event, result?.effects as never)
  return { code: 0, data: runtime.data.data, effect_results: effectResults }
})
