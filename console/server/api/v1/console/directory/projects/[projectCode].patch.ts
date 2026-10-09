import { updateConsoleDirectoryProject } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryProjectInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目注册表编辑权限')
  requireIdempotencyKey(event)

  const projectCode = getRouterParam(event, 'projectCode')
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  const body = await readBody<DirectoryProjectInput>(event)
  await updateConsoleDirectoryProject(event, projectCode, body as Record<string, unknown>)

  return ok(await getDirectoryProject(projectCode))
})
