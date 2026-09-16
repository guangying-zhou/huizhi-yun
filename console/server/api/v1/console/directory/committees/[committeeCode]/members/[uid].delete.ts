import { removeConsoleDirectoryCommitteeMember } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要委员会成员编辑权限')
  requireIdempotencyKey(event)

  const committeeCode = getRouterParam(event, 'committeeCode')
  const uid = getRouterParam(event, 'uid')
  if (!committeeCode) throw createError({ statusCode: 400, message: 'committeeCode is required' })
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  await removeConsoleDirectoryCommitteeMember(event, committeeCode, uid)

  return ok({ removed: true })
})
