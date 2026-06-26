import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { generateNotificationRuntimeInstallCommand } from '~~/server/utils/notificationRuntimeInstall'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  const actor = await requireSystemSettingsAccess(event, 'edit')
  const body = await readBody<{ rotate?: boolean } | null>(event).catch(() => null)

  return ok(await generateNotificationRuntimeInstallCommand({
    event,
    actor,
    rotate: body?.rotate === true
  }))
})
