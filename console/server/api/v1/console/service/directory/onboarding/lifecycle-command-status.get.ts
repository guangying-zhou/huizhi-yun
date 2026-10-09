import { createError, getQuery } from 'h3'
import { readConsoleLifecycleCommandStatus } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { directoryCommandSource } from '~~/server/utils/directoryLifecycleReliable'
import { normalizeLifecycleProbe } from '~~/server/utils/directoryLifecycleStatusProbe'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const input = normalizeLifecycleProbe(getQuery(event))
  const scope = input.kind === 'offboarding' ? 'console:directory-offboarding:disable' : 'console:directory-employment:sync'
  const actor = await requireConsoleServiceActor(event, 'console', scope, { requireBoundTargetApp: true })
  if (directoryCommandSource(actor) !== 'enterprise') throw createError({ statusCode: 403 })
  const result = await readConsoleLifecycleCommandStatus(event, input).catch((error: { statusCode?: number }) => {
    if ([400, 403, 409].includes(Number(error.statusCode))) throw error
    throw createError({ statusCode: 503, statusMessage: 'directory_status_unavailable' })
  })
  const data = result.data
  if (String(result.code) !== '0' || !data) throw createError({ statusCode: 503 })
  const directoryStatus = String(data.directoryStatus)
  const platformStatus = String(data.platformStatus)
  if (data.lifecycleType !== input.kind || !['pending', 'succeeded', 'superseded'].includes(directoryStatus) || !['unknown', 'pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter'].includes(platformStatus)) throw createError({ statusCode: 502 })
  return { code: 0, data: { directoryStatus, platformStatus, lifecycleType: input.kind } }
})
