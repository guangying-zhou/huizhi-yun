/**
 * 迁移期兼容入口：GET /api/account/dept-members?deptCode=xxx
 *
 * 数据源已切到 Console Directory Runtime。
 */
import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler((event) => {
  const deptCode = getQuery(event).deptCode as string | undefined
  if (!deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }

  return fetchConsoleDirectoryApi(`/departments/${encodeURIComponent(deptCode)}/members`)
})
