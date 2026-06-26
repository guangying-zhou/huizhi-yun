import { getQuery } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { getWorkCalendarMonth } from '~~/server/utils/workCalendar'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await getWorkCalendarMonth(getQuery(event)))
})
