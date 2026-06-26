import { createError, getQuery, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import {
  fetchFinancePerformanceAmounts,
  type FinancePerformanceAmountQuery,
  type FinancePerformanceAmountResponse
} from '~~/server/utils/financePerformanceAmounts'
import { resolvePeopleEmployeeAccessQuery } from '~~/server/utils/peopleScopedAuthorization'

interface ApiResponse<T> {
  code?: number
  data?: T
  message?: string
}

interface PerformanceCycleDetail {
  contribution_snapshots?: Array<Record<string, unknown>>
}

type RuntimeQuery = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function emptyPerformanceAmounts(input: FinancePerformanceAmountQuery, warning?: string): FinancePerformanceAmountResponse {
  return {
    data: [],
    total: 0,
    page: input.page || 1,
    pageSize: input.pageSize || 100,
    ...(warning ? { warning } : {})
  }
}

function scopedRuntimeQuery(uid: string, scopeQuery: RuntimeQuery) {
  return {
    ...scopeQuery,
    current_user: uid,
    operator_uid: uid
  }
}

async function fetchScopedCycleEmployeeUids(
  event: H3Event,
  cycleCode: string,
  uid: string,
  scopeQuery: RuntimeQuery
) {
  const runtime = await maybeCallTenantRuntime<ApiResponse<PerformanceCycleDetail>>(
    event,
    `/v1/people/performance-cycles/${encodeURIComponent(cycleCode)}/detail`,
    {
      appCode,
      scope: 'people.read',
      method: 'GET',
      query: scopedRuntimeQuery(uid, scopeQuery)
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'People performance cycle detail is invalid' })
  }
  const snapshots = runtime.data.data?.contribution_snapshots || []
  return uniqueStrings(snapshots.map(item => text(item.employee_uid || item.employeeUid)))
}

async function isEmployeeVisible(
  event: H3Event,
  employeeUid: string,
  uid: string,
  scopeQuery: RuntimeQuery
) {
  try {
    const runtime = await maybeCallTenantRuntime<ApiResponse<Record<string, unknown>>>(
      event,
      `/v1/people/employees/${encodeURIComponent(employeeUid)}`,
      {
        appCode,
        scope: 'people.read',
        method: 'GET',
        query: scopedRuntimeQuery(uid, scopeQuery)
      }
    )
    return runtime.handled && (runtime.data.code === undefined || runtime.data.code === 0) && Boolean(runtime.data.data)
  } catch {
    return false
  }
}

function rowKey(row: Record<string, unknown>) {
  return text(row.code) || [
    text(row.employee_uid || row.employeeUid),
    text(row.period_month || row.periodMonth),
    text(row.performance_type || row.performanceType),
    text(row.id)
  ].join(':')
}

function sortPerformanceRows(rows: Array<Record<string, unknown>>) {
  return rows.sort((left, right) => {
    const leftPeriod = text(left.period_month || left.periodMonth)
    const rightPeriod = text(right.period_month || right.periodMonth)
    if (leftPeriod !== rightPeriod) return rightPeriod.localeCompare(leftPeriod)
    const leftUid = text(left.employee_uid || left.employeeUid)
    const rightUid = text(right.employee_uid || right.employeeUid)
    if (leftUid !== rightUid) return leftUid.localeCompare(rightUid)
    return text(right.id).localeCompare(text(left.id))
  })
}

async function fetchScopedFinancePerformanceAmounts(
  event: H3Event,
  input: FinancePerformanceAmountQuery,
  allowedEmployeeUids: string[]
) {
  const maxEmployees = 200
  const targetEmployeeUids = allowedEmployeeUids.slice(0, maxEmployees)
  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  for (const employeeUid of targetEmployeeUids) {
    const response = await fetchFinancePerformanceAmounts(event, {
      ...input,
      employeeUid,
      page: 1,
      pageSize: 100
    })
    for (const row of response.data || []) {
      const key = rowKey(row)
      if (!key || seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }

  sortPerformanceRows(rows)
  const page = input.page || 1
  const pageSize = input.pageSize || 100
  const offset = (page - 1) * pageSize
  return {
    data: rows.slice(offset, offset + pageSize),
    total: rows.length,
    page,
    pageSize,
    ...(allowedEmployeeUids.length > maxEmployees
      ? { warning: `Only the first ${maxEmployees} visible employees were included.` }
      : {})
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const activeRoleCode = text(query.activeRoleCode || query.active_role_code)
  const snapshot = await assertPeoplePermission(event, activeRoleCode, 'performance_cycles', 'view')
  const uid = text(snapshot.uid)

  const input: FinancePerformanceAmountQuery = {
    cycleCode: text(query.cycleCode || query.cycle_code),
    employeeUid: text(query.employeeUid || query.employee_uid),
    projectCode: text(query.projectCode || query.project_code),
    periodMonth: text(query.periodMonth || query.period_month),
    periodStart: text(query.periodStart || query.period_start),
    periodEnd: text(query.periodEnd || query.period_end),
    page: numberValue(query.page, 1, 100000),
    pageSize: numberValue(query.pageSize || query.page_size, 100, 100)
  }

  const scopeQuery = await resolvePeopleEmployeeAccessQuery(event, uid, 'view', 'performance_cycles')
  const access = text(scopeQuery.current_user_employee_access)

  let data: FinancePerformanceAmountResponse
  if (access === 'all') {
    data = await fetchFinancePerformanceAmounts(event, input)
  } else if (input.cycleCode) {
    const allowedEmployeeUids = await fetchScopedCycleEmployeeUids(event, input.cycleCode, uid, scopeQuery)
    const requestedEmployeeUid = text(input.employeeUid)
    if (requestedEmployeeUid && !allowedEmployeeUids.includes(requestedEmployeeUid)) {
      data = emptyPerformanceAmounts(input)
    } else {
      data = await fetchScopedFinancePerformanceAmounts(
        event,
        requestedEmployeeUid ? { ...input, employeeUid: requestedEmployeeUid } : input,
        requestedEmployeeUid ? [requestedEmployeeUid] : allowedEmployeeUids
      )
    }
  } else if (input.employeeUid && await isEmployeeVisible(event, input.employeeUid, uid, scopeQuery)) {
    data = await fetchFinancePerformanceAmounts(event, input)
  } else if (access === 'self' && uid) {
    data = await fetchFinancePerformanceAmounts(event, { ...input, employeeUid: uid })
  } else {
    data = emptyPerformanceAmounts(input, 'Finance performance amounts require a scoped cycle or employee filter.')
  }

  return {
    code: 0,
    message: 'ok',
    data
  }
})
