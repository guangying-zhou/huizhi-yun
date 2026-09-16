import { readBody } from 'h3'
import { applyConsoleDingTalkDepartmentChanges } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { verifyPeopleHRSourceServiceCommand } from '~~/server/utils/hrSourceSyncService'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

const capability = 'console:hr-source-sync:admin'
const operationCode = 'people.hr-source-sync.dingtalk.department-changes.apply'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', capability, { requireBoundTargetApp: true })
  const body = await readBody<Record<string, unknown>>(event)
  const command = await verifyPeopleHRSourceServiceCommand(event, actor, body, capability, operationCode)
  return await applyConsoleDingTalkDepartmentChanges(event, body, command.actorUid, command.idempotencyKey)
})
