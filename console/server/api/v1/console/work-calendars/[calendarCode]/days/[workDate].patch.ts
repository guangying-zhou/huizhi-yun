import { updateConsoleWorkCalendarDay } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getRouterParam, readBody } from 'h3'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  requireIdempotencyKey(event)
  const body = await readBody<Record<string, unknown>>(event)
  return await updateConsoleWorkCalendarDay(
    event,
    String(getRouterParam(event, 'calendarCode') || ''),
    String(getRouterParam(event, 'workDate') || ''),
    body
  )
})
