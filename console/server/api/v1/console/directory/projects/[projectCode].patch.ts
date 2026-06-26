import { requirePermission } from '~~/server/utils/checkPermission'
import { updateDirectoryProject, type DirectoryProjectInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目注册表编辑权限')

  const projectCode = getRouterParam(event, 'projectCode')
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryProjectInput>(event)
  await updateDirectoryProject(projectCode, body, actorUid)

  return ok(await getDirectoryProject(projectCode))
})
