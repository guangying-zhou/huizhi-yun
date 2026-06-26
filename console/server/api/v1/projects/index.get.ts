import { listDirectoryProjects, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async event => ok(await listDirectoryProjects(getQuery(event))))
