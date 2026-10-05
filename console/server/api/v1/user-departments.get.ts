import { listDirectoryUserDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  return ok(await listDirectoryUserDepartments(query.uid ? String(query.uid) : undefined))
})
