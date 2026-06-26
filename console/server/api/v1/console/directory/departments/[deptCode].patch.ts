import { requirePermission } from '~~/server/utils/checkPermission'
import { updateDirectoryDepartment, type DirectoryDepartmentInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryDepartment, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录部门编辑权限')

  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryDepartmentInput>(event)
  await updateDirectoryDepartment(deptCode, body, actorUid)

  return ok(await getDirectoryDepartment(deptCode))
})
