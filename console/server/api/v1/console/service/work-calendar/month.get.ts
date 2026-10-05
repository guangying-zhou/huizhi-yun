import { getConsoleWorkCalendarMonth } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getQuery } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'system_settings', 'system_settings:view')
  return await getConsoleWorkCalendarMonth(event, getQuery(event))
})
