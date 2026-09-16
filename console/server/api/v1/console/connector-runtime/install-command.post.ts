import { ok } from '~~/server/utils/directoryRuntime'
import { issueConnectorRuntimeEnrollment } from '~~/server/utils/connectorRuntimeEnrollment'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'admin')
  requireIdempotencyKey(event, '生成 Connector Runtime 安装指令必须提供 Idempotency-Key。')
  return ok(await issueConnectorRuntimeEnrollment(event))
})
