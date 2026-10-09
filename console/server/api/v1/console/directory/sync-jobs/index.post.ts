import {
  getConsoleDirectoryProvisioning,
  queueConsoleDirectoryLDAPSync,
  startConsoleDirectorySubjectSync
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requirePermission } from '~~/server/utils/checkPermission'

type DirectorySyncProvider = 'console' | 'manual' | 'account' | 'ldap' | 'wecom' | 'dingtalk' | 'gitlab'
type DirectorySyncScope = 'all' | 'users' | 'departments' | 'projects' | 'identities' | 'subjects'
type DirectorySyncType = 'full' | 'incremental' | 'manual' | 'shadow_check'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'edit', '需要目录同步编辑权限')

  const body = await readBody<{
    providerCode?: DirectorySyncProvider
    syncType?: DirectorySyncType
    objectScope?: DirectorySyncScope
  }>(event)
  const providerCode = body.providerCode || 'console'
  const objectScope = body.objectScope || 'subjects'

  if ((providerCode === 'console' || providerCode === 'manual') && (objectScope === 'subjects' || objectScope === 'all')) {
    await requirePermission(event, 'directory_sync', 'admin', '需要目录同步管理员权限')
    requireIdempotencyKey(event)
    const runtime = await startConsoleDirectorySubjectSync(event, {
      ...body,
      providerCode,
      objectScope
    })
    return ok(runtime.data)
  }

  if (providerCode === 'dingtalk') {
    throw createError({
      statusCode: 410,
      message: '钉钉组织同步已迁移到 People「设置 / 人事事实源」，仅 People 管理员可执行。'
    })
  }
  if (providerCode === 'ldap') {
    const provisioningResponse = await getConsoleDirectoryProvisioning(event)
    const provisioning = provisioningResponse.data as { ldapManaged?: boolean }
    if (provisioning.ldapManaged) {
      requireIdempotencyKey(event)
      const operationResponse = await queueConsoleDirectoryLDAPSync(event)
      const operation = operationResponse.data as { operationId: string, status: string }
      setResponseStatus(event, 202)
      return ok({
        jobCode: operation.operationId,
        providerCode: 'ldap',
        objectScope,
        status: operation.status,
        totalCount: 0,
        connectorOperationId: operation.operationId
      })
    }
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Directory provider runtime unavailable',
    message: `目录源 ${providerCode}/${objectScope} 尚未迁入客户侧 Runtime，已禁止回退 Console 数据库执行`
  })
})
