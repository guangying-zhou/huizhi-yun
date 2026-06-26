import { ok } from '~~/server/utils/directoryRuntime'
import { triggerDataRuntimeUpdate } from '~~/server/utils/dataRuntimeManagement'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  return ok(await triggerDataRuntimeUpdate(event))
})
