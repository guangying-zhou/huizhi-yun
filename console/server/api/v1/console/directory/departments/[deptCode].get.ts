import { requirePermission } from '~~/server/utils/checkPermission'
import { getDirectoryDepartment, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')

  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  const department = await getDirectoryDepartment(deptCode)
  if (!department) throw createError({ statusCode: 404, message: 'Department not found' })

  return ok(department)
})
