import { ok } from '~~/server/utils/directoryRuntime'
import { getDataRuntimeUpdateStatus } from '~~/server/utils/dataRuntimeManagement'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'data_runtime', 'view')
  return ok(await getDataRuntimeUpdateStatus(event))
})
