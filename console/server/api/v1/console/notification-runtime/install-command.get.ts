import { ok } from '~~/server/utils/directoryRuntime'
import { getNotificationRuntimeInstallMetadata } from '~~/server/utils/notificationRuntimeInstall'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')

  return ok(await getNotificationRuntimeInstallMetadata(event))
})
