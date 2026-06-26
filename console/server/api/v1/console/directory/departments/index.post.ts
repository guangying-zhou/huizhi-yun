import { requirePermission } from '~~/server/utils/checkPermission'
import { createDirectoryDepartment, type DirectoryDepartmentInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryDepartment, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录部门编辑权限')

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryDepartmentInput>(event)
  await createDirectoryDepartment(body, actorUid)

  const deptCode = String(body.deptCode || '').trim()
  return ok(await getDirectoryDepartment(deptCode))
})
