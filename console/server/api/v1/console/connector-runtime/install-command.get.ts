import { ok } from '~~/server/utils/directoryRuntime'
import { getConnectorRuntimeMetadata } from '~~/server/utils/connectorRuntimeEnrollment'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  return ok(await getConnectorRuntimeMetadata(event))
})
