import { readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { importWorkCalendarYear } from '~~/server/utils/workCalendar'

export default defineEventHandler(async (event) => {
  const actor = await requireSystemSettingsAccess(event, 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  return ok(await importWorkCalendarYear({
    ...body,
    requestedBy: actor.actorId
  }))
})
