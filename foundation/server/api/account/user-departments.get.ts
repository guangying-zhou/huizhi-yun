/**
 * 迁移期兼容入口：GET /api/account/user-departments
 *
 * 数据源已切到 Console Directory Runtime。
 */
import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/user-departments', {
  params: getQuery(event)
}))
