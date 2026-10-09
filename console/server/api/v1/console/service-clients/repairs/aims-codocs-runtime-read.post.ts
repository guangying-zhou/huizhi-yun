import { callConsoleTenantRuntime } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

interface RuntimeRepairResult {
  code: number
  data: {
    status: 'reconciled'
    serviceClientCode: 'aims.runtime'
    grants: string[]
  }
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'service_clients', 'admin', '需要服务凭证管理员权限')
  const idempotencyKey = requireIdempotencyKey(event)
  await requireConsoleRequestUid(event)

  return await callConsoleTenantRuntime<RuntimeRepairResult>(
    event,
    '/v1/console/admin/service-grant-repairs/aims-codocs-runtime-read',
    {
      scope: 'console:service-client:grant',
      idempotencyKey,
      method: 'POST',
      body: {}
    }
  )
})
