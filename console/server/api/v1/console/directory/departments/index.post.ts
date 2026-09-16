import { createConsoleDirectoryDepartment } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryDepartmentInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryDepartment, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录部门编辑权限')
  requireIdempotencyKey(event)

  const body = await readBody<DirectoryDepartmentInput>(event)
  await createConsoleDirectoryDepartment(event, body as Record<string, unknown>)

  const deptCode = String(body.deptCode || '').trim()
  return ok(await getDirectoryDepartment(deptCode))
})
