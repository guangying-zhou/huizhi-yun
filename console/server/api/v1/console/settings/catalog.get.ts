import { getConsoleSettingCatalogs } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getQuery } from 'h3'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return await getConsoleSettingCatalogs(event, getQuery(event))
})
