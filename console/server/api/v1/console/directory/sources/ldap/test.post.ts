import { requirePermission } from '~~/server/utils/checkPermission'
import { queueConsoleDirectoryLDAPTest } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')
  await requireConsoleRequestUid(event)
  requireIdempotencyKey(event)
  const operation = await queueConsoleDirectoryLDAPTest(event)
  setResponseStatus(event, 202)
  return operation
})
