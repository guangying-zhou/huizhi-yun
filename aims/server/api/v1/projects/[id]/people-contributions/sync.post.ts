import { createError, defineEventHandler, getHeader, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface TimeEntryPage {
  items?: Array<Record<string, unknown>>
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  const base = trimTrailingSlash(baseUrl)
  const normalizedPath = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalizedPath.startsWith('api/v1/')) {
    return `${base}/${normalizedPath.slice('api/v1/'.length)}`
  }
  if (base.endsWith('/api') && normalizedPath.startsWith('api/')) {
    return `${base}/${normalizedPath.slice('api/'.length)}`
  }
  return `${base}/${normalizedPath}`
}

function forwardedContextHeaders(event: H3Event, idempotencyKey: string) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

function firstText(body: RequestBody, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function requireText(body: RequestBody, keys: string[], field: string) {
  const value = firstText(body, ...keys)
  if (!value) {
    throw createError({ statusCode: 400, message: `${field} is required.` })
  }
  return value
}

function dateValue(body: RequestBody, keys: string[], field: string) {
  const value = requireText(body, keys, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: `${field} must be YYYY-MM-DD.` })
  }
  return value
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function timeEntryItems(page: RuntimeEnvelope<TimeEntryPage>) {
  return page.data?.items || []
}

function groupContributionItems(entries: Array<Record<string, unknown>>, body: RequestBody) {
  const defaultRoleCode = text(body.roleCode || body.role_code) || 'delivery'
  const defaultScore = numberValue(body.defaultContributionScore || body.default_contribution_score || 80)
  const groups = new Map<string, {
    employeeUid: string
    projectCode: string
    workHours: number
    timeEntryIds: unknown[]
    workItemKeys: string[]
  }>()

  for (const entry of entries) {
    const employeeUid = text(entry.uid || entry.employee_uid || entry.employeeUid)
    const projectCode = text(entry.projectCode || entry.project_code)
    if (!employeeUid || !projectCode) continue

    const key = `${projectCode}:${employeeUid}`
    const current = groups.get(key) || {
      employeeUid,
      projectCode,
      workHours: 0,
      timeEntryIds: [],
      workItemKeys: []
    }
    current.workHours += numberValue(entry.hours)
    if (entry.id !== undefined && entry.id !== null) current.timeEntryIds.push(entry.id)
    const itemKey = text(entry.itemKey || entry.item_key)
    if (itemKey && !current.workItemKeys.includes(itemKey)) current.workItemKeys.push(itemKey)
    groups.set(key, current)
  }

  return [...groups.values()].map(group => ({
    employee_uid: group.employeeUid,
    project_code: group.projectCode,
    role_code: defaultRoleCode,
    work_hours: Number(group.workHours.toFixed(2)),
    contribution_score: defaultScore,
    source_app: 'aims',
    source_biz_type: 'time_entries',
    source_biz_id: `${group.projectCode}:${group.employeeUid}`,
    source_refs: {
      time_entries: group.timeEntryIds,
      work_items: group.workItemKeys
    }
  }))
}

async function fetchProjectTimeEntries(event: H3Event, projectID: string, uid: string, periodStart: string, periodEnd: string) {
  const query = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId: projectID,
    uid,
    baseQuery: {
      operator_uid: uid,
      start_date: periodStart,
      end_date: periodEnd
    }
  })

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<TimeEntryPage>>(event, `/v1/aims/projects/${encodeURIComponent(projectID)}/time-entries`, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for People contribution sync.' })
  }
  return runtime.data
}

async function syncPeopleContributions(event: H3Event, body: RequestBody, items: ReturnType<typeof groupContributionItems>) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'people')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'People service API base URL is not configured.' })
  }
  const cycleCode = requireText(body, ['cycleCode', 'cycle_code'], 'cycleCode')
  const idempotencyKey = text(getHeader(event, 'idempotency-key'))
    || `aims:people-contributions:${firstText(body, 'projectId', 'project_id')}:${cycleCode}:${firstText(body, 'periodStart', 'period_start')}:${firstText(body, 'periodEnd', 'period_end')}`
  const token = await requestServiceAccessToken({
    audience: 'people',
    scope: 'people:write',
    event
  })
  const response = await $fetch<RuntimeEnvelope<Record<string, unknown>>>(
    appendPath(baseUrl, '/api/v1/service/contributions:sync'),
    {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event, idempotencyKey),
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: {
        cycle_code: cycleCode,
        source_app: 'aims',
        captured_at: text(body.capturedAt || body.captured_at),
        items
      },
      timeout: 10000
    }
  )
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'People service API returned an error.' })
  }
  return response.data || {}
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectID = text(event.context.params?.id)
  if (!projectID) {
    throw createError({ statusCode: 400, message: 'project id is required.' })
  }
  const body = ((await readBody<RequestBody>(event).catch(() => ({} as RequestBody))) || {}) as RequestBody
  requireText(body, ['cycleCode', 'cycle_code'], 'cycleCode')
  const periodStart = dateValue(body, ['periodStart', 'period_start'], 'periodStart')
  const periodEnd = dateValue(body, ['periodEnd', 'period_end'], 'periodEnd')
  const page = await fetchProjectTimeEntries(event, projectID, uid, periodStart, periodEnd)
  const entries = timeEntryItems(page)
  const items = groupContributionItems(entries, body)
  if (items.length === 0) {
    return {
      code: 0,
      data: {
        projectId: projectID,
        periodStart,
        periodEnd,
        timeEntryRows: entries.length,
        synced: 0,
        skipped: 'no time entries with uid and project_code'
      }
    }
  }

  const peopleSync = await syncPeopleContributions(event, body, items)
  return {
    code: 0,
    data: {
      projectId: projectID,
      periodStart,
      periodEnd,
      timeEntryRows: entries.length,
      contributionItems: items.length,
      peopleSync
    }
  }
})
