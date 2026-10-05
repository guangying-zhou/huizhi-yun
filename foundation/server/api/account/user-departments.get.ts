/**
 * 迁移期兼容入口：GET /api/account/user-departments
 *
 * 数据源已切到 Console Directory Runtime。
 */
import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'
import { requireFoundationSessionUid } from '../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)
  return fetchConsoleDirectoryApi('/user-departments', {
    params: getQuery(event)
  })
})
