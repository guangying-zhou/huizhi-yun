/**
 * 获取部门列表
 *
 * 迁移期保留 /api/account/departments 路由名，数据源已切到 Console directory-runtime。
 * 路由: GET /api/account/departments
 */
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

export default defineEventHandler(event => fetchDirectoryApi('/api/v1/directory/departments', {
  params: getQuery(event)
}))
