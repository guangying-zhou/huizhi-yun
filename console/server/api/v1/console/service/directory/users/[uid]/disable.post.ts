import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { applyConsoleDirectoryLifecycle } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { resolvePeopleDirectoryTargetBinding, verifyPeopleDirectorySignature } from '~~/server/utils/directoryLifecycleReliable'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-offboarding:disable', { requireBoundTargetApp: true })
  const actorId = String(actor.actorId || '').trim()
  if (!actorId) throw createError({ statusCode: 403, message: 'People service actor identity is required.' })
  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const uid = String(getRouterParam(event, 'uid') || '').trim()
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const commandUid = String(((body.serviceCommand as Record<string, unknown> | undefined)?.command as Record<string, unknown> | undefined)?.employeeUid || '').trim()
  if (!uid || uid !== commandUid) throw createError({ statusCode: 409, message: 'route uid does not match frozen command' })
  const runtime = await applyConsoleDirectoryLifecycle(event, uid, 'offboarding', body)
  const receipt = runtime.data
  if (String((receipt.result as Record<string, unknown> | undefined)?.platformOperationKey || '') && String((receipt.result as Record<string, unknown>).platformStatus || '') !== 'succeeded') setResponseStatus(event, 202)
  return { code: 0, message: 'ok', data: receipt }
})
