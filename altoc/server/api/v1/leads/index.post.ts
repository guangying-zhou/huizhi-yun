import { createError, readBody, type H3Event } from 'h3'
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

interface LeadCreateResult {
  id?: number | string
  code?: string
  lead?: LeadAssignedNotice | null
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
    scope: 'altoc.write altoc:lead:edit',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for lead creation.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'lead', 'edit')

  const body = objectBody(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'lead', 'edit')
  const result = await callAltocRuntime<LeadCreateResult>(event, '/v1/altoc/leads', body, dataAccessQuery)
  const creatorUid = getRequestUid(event) || 'system'
  const notified = await notifyLeadAssignedItem(result.lead, creatorUid)

  return {
    code: 0,
    message: '创建成功',
    data: {
      ...result,
      notified_assignees: notified
    }
  }
})
