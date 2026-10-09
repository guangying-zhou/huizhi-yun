import { getConsoleWorkCalendarDays } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getQuery, getRouterParam } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'system_settings', 'system_settings:view')
  return await getConsoleWorkCalendarDays(
    event,
    String(getRouterParam(event, 'calendarCode') || ''),
    getQuery(event)
  )
})
