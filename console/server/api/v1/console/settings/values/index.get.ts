import { getQuery } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'
import { listSettingValues } from '~~/server/utils/systemParameters'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await listSettingValues(getQuery(event)))
})
