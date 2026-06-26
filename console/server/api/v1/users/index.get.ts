import { listDirectoryUsers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryUsers(getQuery(event))))
