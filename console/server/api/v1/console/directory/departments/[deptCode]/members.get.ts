import { requirePermission } from '~~/server/utils/checkPermission'
import { listDirectoryDepartmentMembers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')

  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })
  return ok(await listDirectoryDepartmentMembers(deptCode, getQuery(event)))
})
