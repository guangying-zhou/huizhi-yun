/**
 * Account 兼容入口：获取部门树。
 */
import { listDirectoryDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryDepartments(getQuery(event))))
