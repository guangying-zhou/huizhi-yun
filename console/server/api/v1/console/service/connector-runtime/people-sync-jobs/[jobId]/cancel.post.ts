import { createError, getRouterParam, readBody } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { cancelConnectorPeopleSync } from '~~/server/utils/connectorPeopleSync'
import { verifyPeopleHRSourceServiceCommand } from '~~/server/utils/hrSourceSyncService'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

const capability = 'console:hr-source-sync:execute'
const operationCode = 'people.hr-source-sync.dingtalk.jobs.cancel'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', capability, { requireBoundTargetApp: true })
  const body = await readBody<Record<string, unknown>>(event)
  const verified = await verifyPeopleHRSourceServiceCommand(event, actor, body, capability, operationCode)
  const jobId = String(getRouterParam(event, 'jobId') || '')
  if (String(verified.command.jobId || '') !== jobId) {
    throw createError({ statusCode: 409, message: 'People HR source job command does not match the route.' })
  }
  return ok(await cancelConnectorPeopleSync(event, jobId, verified.actorUid, verified.idempotencyKey))
})
