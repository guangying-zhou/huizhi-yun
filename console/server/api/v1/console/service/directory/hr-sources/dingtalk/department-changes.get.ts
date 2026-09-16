import { getConsoleDingTalkDepartmentChanges } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'console', 'console:hr-source-sync:view', { requireBoundTargetApp: true })
  return await getConsoleDingTalkDepartmentChanges(event)
})
