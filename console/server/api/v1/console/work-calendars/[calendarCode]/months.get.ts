import { getConsoleWorkCalendarMonths } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getQuery, getRouterParam } from 'h3'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return await getConsoleWorkCalendarMonths(
    event,
    String(getRouterParam(event, 'calendarCode') || ''),
    getQuery(event)
  )
})
