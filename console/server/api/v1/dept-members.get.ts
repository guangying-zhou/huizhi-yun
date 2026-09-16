import { listDirectoryDepartmentMembers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = String(query.dept_code || query.deptCode || '')
  if (!deptCode) throw createError({ statusCode: 400, message: 'dept_code is required' })
  return ok(await listDirectoryDepartmentMembers(deptCode, query))
})
