import { createError, getHeader, getRouterParam, readBody } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

type Row = Record<string, unknown>
type Envelope = { code?: number | string, data?: Row, message?: string }

export default defineEventHandler(async (event) => {
  requireServiceScope(event, { scope: 'aims:service-ticket:work-item:create', allowedApps: ['altoc'] })
  const actorUid = String(getHeader(event, 'x-hzy-actor-uid') || '').trim()
  const ticketCode = String(getRouterParam(event, 'ticketCode') || '').trim()
  const body = (await readBody<Row>(event)) || {}
  const envelope = body.serviceCommand as Row | undefined
  const command = envelope?.command as Row | undefined
  if (!actorUid || String(command?.ticketCode || '').trim() !== ticketCode) {
    throw createError({ statusCode: 403, message: 'Trusted Altoc actor and ticket binding must match the frozen command.' })
  }
  const runtime = await maybeCallTenantRuntime<Envelope>(event, `/v1/aims/service/service-tickets/${encodeURIComponent(ticketCode)}/work-item:receive`, {
    appCode: 'aims', scope: 'aims:service-ticket:work-item:create', method: 'POST', body,
    serviceCommandActor: { uid: actorUid }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') throw createError({ statusCode: 502, message: runtime.data.message || 'Aims work item receipt failed.' })
  return { code: 0, data: runtime.data.data }
})
