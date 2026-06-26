import { getQuery, getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { listWorkCalendarDays } from '~~/server/utils/workCalendar'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await listWorkCalendarDays({
    ...getQuery(event),
    calendarCode: getRouterParam(event, 'calendarCode')
  }))
})
