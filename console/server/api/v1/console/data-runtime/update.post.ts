import { ok } from '~~/server/utils/directoryRuntime'
import { triggerDataRuntimeUpdate } from '~~/server/utils/dataRuntimeManagement'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'data_runtime', 'deploy')
  return ok(await triggerDataRuntimeUpdate(event))
})
