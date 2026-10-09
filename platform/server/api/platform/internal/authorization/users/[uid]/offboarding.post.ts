import { getRouterParam, readBody } from 'h3'
import { withTransaction } from '~~/server/utils/db'
import { executePlatformLifecycleCommand, trustedPlatformLifecycleBinding } from '~~/server/utils/lifecycleServiceCommand'

export default defineEventHandler(async (event) => {
  if (event.context.platformAccessScope !== 'internal' || event.context.platformInternalPrincipal !== 'console-directory-runtime') throw createError({ statusCode: 403, message: 'trusted Console Directory principal required' })
  const uid = String(getRouterParam(event, 'uid') || '').trim()
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  const envelope = (body.serviceCommand || {}) as Record<string, unknown>
  const binding = trustedPlatformLifecycleBinding(event, envelope)
  return { code: 0, success: true, data: await withTransaction(tx => executePlatformLifecycleCommand(tx, body, 'offboarding', uid, binding)) }
})
