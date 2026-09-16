import { listDirectoryDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryDepartments(getQuery(event))))
