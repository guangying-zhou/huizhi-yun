import { createError, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

interface ApiResponse<T> {
  code?: number
  data?: T
  message?: string
}

interface PerformanceCycle {
  cycle_code: string
  project_code?: string | null
  period_start: string
  period_end: string
}

interface PerformanceCycleDetail {
  cycle: PerformanceCycle
}

interface RuntimeList<T> {
  items?: T[]
  total?: number
}

interface AimsProject {
  id?: number | string
  project_code?: string
}

interface AimsTimeEntry {
  id?: number | string
  uid?: string | null
  employee_uid?: string | null
  employeeUid?: string | null
  projectCode?: string | null
  project_code?: string | null
  itemKey?: string | null
  item_key?: string | null
  hours?: number | string | null
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function unwrapData<T>(response: ApiResponse<T>, fallbackMessage: string) {
  if (response?.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || fallbackMessage })
  }
  if (!response?.data) {
    throw createError({ statusCode: 502, message: fallbackMessage })
  }
  return response.data
}

function mysqlTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

async function fetchCycleDetail(event: H3Event, cycleCode: string) {
  const runtime = await maybeCallTenantRuntime<ApiResponse<PerformanceCycleDetail>>(
    event,
    `/v1/people/performance-cycles/${encodeURIComponent(cycleCode)}/detail`,
    {
      appCode,
      scope: 'people.read',
      method: 'GET'
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }

  return unwrapData(runtime.data, 'People performance cycle detail is invalid')
}

async function resolveAimsProject(event: H3Event, projectCode: string) {
  const runtime = await maybeCallTenantRuntime<ApiResponse<RuntimeList<AimsProject>>>(
    event,
    '/v1/aims/admin/projects',
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: {
        search: projectCode,
        page: 1,
        pageSize: 100
      }
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is not configured' })
  }

  const list = unwrapData(runtime.data, 'Aims project list is invalid')
  const matches = (list.items || []).filter(project => text(project.project_code) === projectCode)
  if (matches.length === 0) {
    throw createError({ statusCode: 404, message: `Aims project not found for project_code: ${projectCode}` })
  }
  const project = matches[0]!
  const projectID = text(project.id)
  if (!projectID) {
    throw createError({ statusCode: 502, message: `Aims project id is empty for project_code: ${projectCode}` })
  }
  return projectID
}

async function fetchAimsTimeEntries(
  event: H3Event,
  projectID: string,
  periodStart: string,
  periodEnd: string
) {
  const runtime = await maybeCallTenantRuntime<ApiResponse<RuntimeList<AimsTimeEntry>>>(
    event,
    `/v1/aims/projects/${encodeURIComponent(projectID)}/time-entries`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: {
        start_date: periodStart,
        end_date: periodEnd
      }
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is not configured' })
  }

  return unwrapData(runtime.data, 'Aims time entries response is invalid')
}

function groupContributionItems(entries: AimsTimeEntry[], body: RequestBody, periodStart: string, periodEnd: string, aimsProjectID: string) {
  const defaultRoleCode = text(body.roleCode || body.role_code) || 'delivery'
  const defaultScore = numberValue(body.defaultContributionScore || body.default_contribution_score || 80)
  const groups = new Map<string, {
    employeeUid: string
    projectCode: string
    workHours: number
    timeEntryIds: Array<string | number>
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
      aims_project_id: aimsProjectID,
      period_start: periodStart,
      period_end: periodEnd,
      time_entries: group.timeEntryIds,
      work_items: group.workItemKeys
    }
  }))
}

async function syncPeopleContributions(
  event: H3Event,
  cycleCode: string,
  capturedAt: string,
  items: ReturnType<typeof groupContributionItems>
) {
  const runtime = await maybeCallTenantRuntime<ApiResponse<Record<string, unknown>>>(
    event,
    '/v1/people/service/contributions:sync',
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      body: {
        cycle_code: cycleCode,
        source_app: 'aims',
        captured_at: capturedAt,
        items
      }
    }
  )

  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }

  return unwrapData(runtime.data, 'People contribution sync response is invalid')
}

export default defineEventHandler(async (event) => {
  const cycleCode = text(getRouterParam(event, 'code'))
  if (!cycleCode) {
    throw createError({ statusCode: 400, message: 'cycleCode is required' })
  }

  const body = await readBody<RequestBody>(event).catch(() => ({} as RequestBody))
  const activeRoleCode = text(body.activeRoleCode || body.active_role_code)
  await assertPeoplePermission(event, activeRoleCode, 'performance_cycles', 'edit')

  const detail = await fetchCycleDetail(event, cycleCode)
  const cycle = detail.cycle
  const projectCode = text(cycle.project_code)
  if (!projectCode) {
    throw createError({ statusCode: 400, message: 'Only project-scoped performance cycles can collect Aims contributions for now.' })
  }

  const periodStart = text(body.periodStart || body.period_start) || text(cycle.period_start)
  const periodEnd = text(body.periodEnd || body.period_end) || text(cycle.period_end)
  if (!validDate(periodStart) || !validDate(periodEnd)) {
    throw createError({ statusCode: 400, message: 'periodStart and periodEnd must be YYYY-MM-DD.' })
  }
  if (periodStart > periodEnd) {
    throw createError({ statusCode: 400, message: 'periodStart must be earlier than or equal to periodEnd.' })
  }

  const aimsProjectID = await resolveAimsProject(event, projectCode)
  const timeEntries = await fetchAimsTimeEntries(event, aimsProjectID, periodStart, periodEnd)
  const entries = timeEntries.items || []
  const items = groupContributionItems(entries, body, periodStart, periodEnd, aimsProjectID)

  if (items.length === 0) {
    return {
      code: 0,
      data: {
        cycleCode,
        projectCode,
        aimsProjectId: aimsProjectID,
        periodStart,
        periodEnd,
        timeEntryRows: entries.length,
        contributionItems: 0,
        synced: 0,
        skipped: 'no time entries with uid and project_code'
      }
    }
  }

  const peopleSync = await syncPeopleContributions(
    event,
    cycleCode,
    text(body.capturedAt || body.captured_at) || mysqlTimestamp(),
    items
  )

  return {
    code: 0,
    data: {
      cycleCode,
      projectCode,
      aimsProjectId: aimsProjectID,
      periodStart,
      periodEnd,
      timeEntryRows: entries.length,
      contributionItems: items.length,
      synced: Number(peopleSync.synced || 0),
      peopleSync
    }
  }
})
