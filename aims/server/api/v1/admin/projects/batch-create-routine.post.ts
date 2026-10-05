import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { H3Event } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requireAimsAdminRoleAccess } from '~~/server/utils/aimsAdminAccess'

interface DirectoryDepartment {
  deptCode?: string
  name?: string
  orgType?: string
  managerId?: string | null
}

interface DirectoryUser {
  uid?: string
}

interface DirectoryEnvelope<T> {
  code: number
  message?: string
  data?: T
}

interface RoutineBatchResult {
  year: number
  portfolio: {
    id: number
    created: boolean
    reactivated: boolean
  }
  summary: {
    departments: number
    created: number
    existing: number
    missingManager: number
  }
  items: Array<{
    deptCode: string
    departmentName: string
    projectName: string
    projectCode?: string
    projectId?: number
    memberCount?: number
    status: 'created' | 'skipped'
    reason?: 'exists' | 'missing_manager'
  }>
}

interface RuntimeEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

function normalizeYear(value: unknown) {
  const year = Number(value)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, message: '年度必须是 2000 至 2100 之间的整数' })
  }
  return year
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index]!)
    }
  })

  await Promise.all(workers)
  return results
}

async function loadDepartmentMemberUids(event: H3Event, deptCode: string) {
  const memberUids = new Set<string>()
  let page = 1

  while (true) {
    const response = await fetchConsoleDirectoryApi<DirectoryEnvelope<{
      items?: DirectoryUser[]
      total?: number
      page?: number
      pageSize?: number
    }>>('/users', {
      event,
      params: {
        dept_code: deptCode,
        status: 'active',
        page,
        pageSize: 100
      }
    })

    if (response.code !== 0 || !response.data) {
      throw createError({
        statusCode: 502,
        message: response.message || `读取部门 ${deptCode} 成员失败`
      })
    }

    const members = Array.isArray(response.data.items) ? response.data.items : []
    for (const member of members) {
      const uid = String(member.uid || '').trim()
      if (uid) memberUids.add(uid)
    }

    const total = Math.max(0, Number(response.data.total || 0))
    if (members.length === 0 || memberUids.size >= total) break
    page += 1
  }

  return [...memberUids].sort()
}

export default defineEventHandler(async (event) => {
  await requireAimsAdminRoleAccess(event, '仅系统管理员可以批量创建部门事务项目')

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody<{ year?: unknown }>(event)
  const year = normalizeYear(body?.year)

  const departmentResponse = await fetchConsoleDirectoryApi<DirectoryEnvelope<{
    flat?: DirectoryDepartment[]
  }>>('/departments', { event })
  if (departmentResponse.code !== 0 || !departmentResponse.data) {
    throw createError({
      statusCode: 502,
      message: departmentResponse.message || '读取部门目录失败'
    })
  }

  const departmentsByCode = new Map<string, Required<Pick<DirectoryDepartment, 'deptCode' | 'name'>> & {
    managerId: string | null
  }>()
  for (const department of departmentResponse.data.flat || []) {
    if ((department.orgType || 'department') !== 'department') continue
    const deptCode = String(department.deptCode || '').trim()
    const name = String(department.name || '').trim()
    if (!deptCode || !name) continue
    departmentsByCode.set(deptCode, {
      deptCode,
      name,
      managerId: String(department.managerId || '').trim() || null
    })
  }

  const departments = [...departmentsByCode.values()]
    .sort((left, right) => left.deptCode.localeCompare(right.deptCode))
  if (departments.length === 0) {
    throw createError({ statusCode: 409, message: '当前目录中没有可创建事务项目的有效部门' })
  }

  const routineDepartments = await mapWithConcurrency(departments, 5, async department => ({
    deptCode: department.deptCode,
    name: department.name,
    managerUid: department.managerId,
    memberUids: department.managerId
      ? await loadDepartmentMemberUids(event, department.deptCode)
      : []
  }))

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RoutineBatchResult>>(
    event,
    '/v1/aims/admin/projects/batch-create-routine',
    {
      appCode: 'aims',
      scope: 'aims.write',
      method: 'POST',
      query: {
        current_user: uid,
        current_user_is_project_admin: '1'
      },
      body: {
        year,
        departments: routineDepartments
      }
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required to batch create routine projects.'
    })
  }

  const response = runtime.data
  if (!response || (response.code !== undefined && response.code !== 0)) {
    throw createError({ statusCode: 502, message: response?.message || '批量创建部门事务项目失败' })
  }
  return response
})
