import { requirePermission } from '~~/server/utils/checkPermission'
import { deleteDirectoryDepartment } from '~~/server/utils/directoryAdmin'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录部门编辑权限')

  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  const actorUid = await requireConsoleRequestUid(event)
  await deleteDirectoryDepartment(deptCode, actorUid)

  return ok({ deleted: true })
})
