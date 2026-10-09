import { createError, getHeader, getQuery, readBody, type H3Event } from 'h3'
import { fetchConsoleDirectoryApi, fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'
import { callEnterpriseRuntime, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { requireAimsHostAdmin } from './enterpriseAimsAdminProjects'

type Department = { deptCode?: string, name?: string, orgType?: string, managerId?: string | null }
type Envelope<T> = { code: number, data?: T }

export async function enterpriseAimsRoutineBatch(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '批量创建参数无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  const input = await readBody<Record<string, unknown>>(event)
  if (!key || key.length > 191 || !input || Array.isArray(input) || Object.keys(input).some(field => field !== 'year') || !Number.isInteger(input.year) || Number(input.year) < 2000 || Number(input.year) > 2100) throw createError({ statusCode: 400, message: '请选择 2000 至 2100 年，并提供有效操作标识' })
  const { user, authorization } = await requireAimsHostAdmin(event)
  await prepareEnterpriseRuntime(event, 'aims.admin-project-routine-batch')
  const response = await fetchConsoleDirectoryApi<Envelope<{ flat: Department[] }>>('/departments', { event })
  if (response.code !== 0 || !Array.isArray(response.data?.flat)) throw createError({ statusCode: 503, message: '部门目录暂不可用' })
  const source = [...new Map(response.data.flat.filter(row => (row.orgType || 'department') === 'department' && row.deptCode?.trim() && row.name?.trim()).map(row => [row.deptCode!, row])).values()].sort((a, b) => a.deptCode!.localeCompare(b.deptCode!))
  if (!source.length || source.length > 1000) throw createError({ statusCode: 409, message: '有效部门必须为 1 至 1000 个' })
  const managers = [...new Set(source.map(row => row.managerId?.trim()).filter((uid): uid is string => Boolean(uid)))]
  const active = new Set<string>()
  for (let start = 0; start < managers.length; start += 100) {
    for (const row of await fetchDirectoryActiveStatuses(event, managers.slice(start, start + 100))) if (row.active) active.add(row.uid)
  }
  const departments = []
  for (const row of source) {
    const managerUid = active.has(row.managerId?.trim() || '') ? row.managerId!.trim() : ''
    const memberUids = new Set<string>()
    if (managerUid) {
      for (let page = 1; page <= 1000; page++) {
        const users = await fetchConsoleDirectoryApi<Envelope<{ items: { uid: string }[], total: number, page: number, pageSize: number }>>('/users', { event, params: { dept_code: row.deptCode, status: 'active', page, pageSize: 100 } })
        const data = users.data
        if (users.code !== 0 || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== page || data.pageSize !== 100) throw createError({ statusCode: 503, message: '部门成员目录暂不可用' })
        for (const item of data.items) if (item.uid?.trim()) memberUids.add(item.uid.trim())
        if (page * 100 >= data.total) break
        if (!data.items.length || page === 1000) throw createError({ statusCode: 503, message: '部门成员目录不完整' })
      }
    }
    departments.push({ deptCode: row.deptCode!.trim(), name: row.name!.trim(), managerUid, memberUids: [...memberUids].sort() })
  }
  return await callEnterpriseRuntime(event, 'aims.admin-project-routine-batch', { tenant: user.tenant, deployment: user.deployment, authorization, year: input.year, departments }, { idempotencyKey: key })
}
