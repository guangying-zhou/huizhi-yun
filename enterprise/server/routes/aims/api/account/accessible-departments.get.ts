import { createError, defineEventHandler, setHeader } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

// 保留独立应用的 URL（/api/account/accessible-departments）与 { code, data } 契约，
// 但宿主只经 directory-self 固定操作读取：Runtime 从签名 actor 计算
// “所在/负责/分管部门及全部下级”，宿主不转发 uid、查询参数或请求体，
// 也不持有 console:directory-department:view。
const operation = 'console.directory-self-accessible-departments'

function statusOf(error: unknown) {
  const value = error as { statusCode?: unknown, status?: unknown } | null
  const status = Number(value?.statusCode ?? value?.status)
  return Number.isInteger(status) ? status : 0
}

function projectDepartments(value: unknown) {
  const rows = value && typeof value === 'object' && 'data' in value ? (value as { data?: unknown }).data : undefined
  if (!Array.isArray(rows)) return null
  const departments: Array<{ deptCode: string, name: string }> = []
  for (const row of rows) {
    const record = row as { deptCode?: unknown, name?: unknown } | null
    if (!record || typeof record.deptCode !== 'string' || !record.deptCode || typeof record.name !== 'string') return null
    departments.push({ deptCode: record.deptCode, name: record.name })
  }
  return departments
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireEnterpriseUser(event)
  let response: unknown
  try {
    await prepareEnterpriseRuntime(event, operation)
    response = await callEnterpriseRuntime(event, operation, {})
  } catch (error) {
    const status = statusOf(error)
    if (status === 401) throw createError({ statusCode: 401, message: '登录状态已失效，请重新登录' })
    if (status === 403) throw createError({ statusCode: 403, message: '缺少读取可选部门的权限' })
    throw createError({ statusCode: 503, message: '可选部门暂不可用，请稍后重试' })
  }
  const departments = projectDepartments(response)
  if (!departments) throw createError({ statusCode: 503, message: '可选部门暂不可用，请稍后重试' })
  return { code: 0, data: departments }
})
