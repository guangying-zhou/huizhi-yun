import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleWorkCalendarMonth } from '@hzy/foundation/app/types/consoleWorkCalendar'
import { consoleWorkCalendarQuery, consoleWorkCalendarCode } from '../../../../../utils/consoleWorkCalendarRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleWorkCalendarQuery(event, 'year')
  const calendarCode = consoleWorkCalendarCode(event)
  const data = await fetchConsoleUserApi<{ items: ConsoleWorkCalendarMonth[] }>(event, 'work-calendars.months.list', { query, params: { calendarCode } })
  return { code: 0, data }
})
