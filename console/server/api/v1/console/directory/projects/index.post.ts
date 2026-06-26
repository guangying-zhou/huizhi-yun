import { requirePermission } from '~~/server/utils/checkPermission'
import { createDirectoryProject, type DirectoryProjectInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目注册表编辑权限')

  const actorUid = await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryProjectInput>(event)
  await createDirectoryProject(body, actorUid)

  const projectCode = String(body.projectCode || '').trim()
  return ok(await getDirectoryProject(projectCode))
})
