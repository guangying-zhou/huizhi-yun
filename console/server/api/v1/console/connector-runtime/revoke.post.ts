import { ok } from '~~/server/utils/directoryRuntime'
import { revokeConnectorRuntime } from '~~/server/utils/connectorRuntimeDevice'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'admin')
  requireIdempotencyKey(event, '吊销 Connector Runtime 必须提供 Idempotency-Key。')
  return ok(await revokeConnectorRuntime(event))
})
