import { getRouterParam } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { getConnectorPeopleSync } from '~~/server/utils/connectorPeopleSync'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'console', 'console:hr-source-sync:view', { requireBoundTargetApp: true })
  return ok(await getConnectorPeopleSync(event, getRouterParam(event, 'jobId')))
})
