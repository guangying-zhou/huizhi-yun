import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { listWorkCalendars } from '~~/server/utils/workCalendar'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await listWorkCalendars())
})
