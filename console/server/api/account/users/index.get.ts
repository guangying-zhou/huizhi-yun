/**
 * Account 兼容入口：获取用户列表。
 * 迁移期保留 `/api/account/users` 路由名，但数据源已切到 Console directory-runtime。
 */
import { listDirectoryUsers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryUsers(getQuery(event))))
