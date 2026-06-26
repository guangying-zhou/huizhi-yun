import { ok } from '~~/server/utils/directoryRuntime'
import { getDataRuntimeOverview } from '~~/server/utils/dataRuntimeManagement'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await getDataRuntimeOverview(event))
})
