/**
 * Account 兼容入口：获取项目注册表。
 */
import { listDirectoryProjects, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryProjects(getQuery(event))))
