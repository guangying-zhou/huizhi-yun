import { ok } from '~~/server/utils/directoryRuntime'
import { getDataRuntimeUpdateStatus } from '~~/server/utils/dataRuntimeManagement'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  return ok(await getDataRuntimeUpdateStatus(event))
})
