import { deleteConsoleDirectoryCommittee } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录组织编辑权限')
  requireIdempotencyKey(event)

  const committeeCode = getRouterParam(event, 'committeeCode')
  if (!committeeCode) throw createError({ statusCode: 400, message: 'committeeCode is required' })

  await deleteConsoleDirectoryCommittee(event, committeeCode)

  return ok({ deleted: true })
})
