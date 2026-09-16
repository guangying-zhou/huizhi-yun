import { createConsoleDirectoryProject } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryProjectInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_projects', 'edit', '需要项目注册表编辑权限')
  requireIdempotencyKey(event)

  const body = await readBody<DirectoryProjectInput>(event)
  await createConsoleDirectoryProject(event, body as Record<string, unknown>)

  const projectCode = String(body.projectCode || '').trim()
  return ok(await getDirectoryProject(projectCode))
})
