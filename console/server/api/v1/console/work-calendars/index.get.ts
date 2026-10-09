import { getConsoleWorkCalendars } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return await getConsoleWorkCalendars(event)
})
