import { updateConsoleDirectoryDepartment } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryDepartmentInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryDepartment, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录部门编辑权限')
  requireIdempotencyKey(event)

  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  const body = await readBody<DirectoryDepartmentInput>(event)
  await updateConsoleDirectoryDepartment(event, deptCode, body as Record<string, unknown>)

  return ok(await getDirectoryDepartment(deptCode))
})
