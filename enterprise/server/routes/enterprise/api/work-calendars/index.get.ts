import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleWorkCalendar } from '@hzy/foundation/app/types/consoleWorkCalendar'
import { consoleWorkCalendarQuery } from '../../../../utils/consoleWorkCalendarRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleWorkCalendarQuery(event)
  const data = await fetchConsoleUserApi<{ items: ConsoleWorkCalendar[] }>(event, 'work-calendars.list', { query })
  return { code: 0, data }
})
