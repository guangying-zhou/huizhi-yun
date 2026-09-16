import { readBody, setResponseStatus } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { startConnectorPeopleSync } from '~~/server/utils/connectorPeopleSync'
import { verifyPeopleHRSourceServiceCommand } from '~~/server/utils/hrSourceSyncService'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

const capability = 'console:hr-source-sync:execute'
const operationCode = 'people.hr-source-sync.dingtalk.jobs.start'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', capability, { requireBoundTargetApp: true })
  const body = await readBody<Record<string, unknown>>(event)
  const verified = await verifyPeopleHRSourceServiceCommand(event, actor, body, capability, operationCode)
  const job = await startConnectorPeopleSync(event, {
    objectScopes: ['organization', 'people'],
    idempotencyKey: verified.idempotencyKey,
    originalActorUid: verified.actorUid
  })
  setResponseStatus(event, 202)
  return ok(job)
})
