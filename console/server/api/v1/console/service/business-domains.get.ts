import { getConsoleBusinessDomains } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getQuery } from 'h3'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(
    event,
    'console',
    'console:business-domain:view',
    { requireBoundTargetApp: true }
  )
  const binding = resolveConsoleRuntimeBinding(event)
  if (!actor.actorId || !actor.appCode || actor.tenantCode !== binding.tenantId) {
    throw createError({ statusCode: 403, message: 'business-domain service actor tenant binding mismatch' })
  }

  return await getConsoleBusinessDomains(event, getQuery(event))
})
