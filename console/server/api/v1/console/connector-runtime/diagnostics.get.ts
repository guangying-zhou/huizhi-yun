import { setHeader } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { readConnectorRuntimeDiagnostics } from '~~/server/utils/connectorRuntimeDiagnostics'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'view')
  setHeader(event, 'Cache-Control', 'no-store')
  return ok(await readConnectorRuntimeDiagnostics(event))
})
