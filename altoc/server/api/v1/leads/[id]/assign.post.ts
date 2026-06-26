import { createError, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  notifyLeadAssignedItem,
  type LeadAssignedNotice
} from '~~/server/utils/runtimeNotifications'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface LeadAssignResult {
  lead?: LeadAssignedNotice | null
  changed?: boolean
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:lead:assign',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for lead assignment.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'lead', 'assign')

  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!id) {
    throw createError({ statusCode: 400, message: 'lead id is required' })
  }

  const body = objectBody(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'lead', 'assign')
  const result = await callAltocRuntime<LeadAssignResult>(
    event,
    `/v1/altoc/leads/${encodeURIComponent(id)}/assign`,
    body,
    dataAccessQuery
  )
  const assignerUid = getRequestUid(event) || 'system'
  const notified = result.changed === false
    ? 0
    : await notifyLeadAssignedItem(result.lead, assignerUid)

  return {
    code: 0,
    message: 'ok',
    data: {
      ...result,
      notified_assignees: notified
    }
  }
})
