import { getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { updateWorkCalendarDay } from '~~/server/utils/workCalendar'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  return ok(await updateWorkCalendarDay({
    ...body,
    calendarCode: getRouterParam(event, 'calendarCode'),
    workDate: getRouterParam(event, 'workDate')
  }))
})
