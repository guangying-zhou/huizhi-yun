import { importConsoleWorkCalendarYear } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { readBody } from 'h3'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  requireIdempotencyKey(event)
  const body = await readBody<Record<string, unknown>>(event)
  return await importConsoleWorkCalendarYear(event, body)
})
