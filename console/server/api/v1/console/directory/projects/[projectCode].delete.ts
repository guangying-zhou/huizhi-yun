import { requirePermission } from '~~/server/utils/checkPermission'
import { deleteDirectoryProject } from '~~/server/utils/directoryAdmin'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目注册表编辑权限')

  const projectCode = getRouterParam(event, 'projectCode')
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  const actorUid = await requireConsoleRequestUid(event)
  await deleteDirectoryProject(projectCode, actorUid)

  return ok({ deleted: true })
})
