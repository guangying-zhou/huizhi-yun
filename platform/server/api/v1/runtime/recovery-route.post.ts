import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { publishRecoveryRoute, type RecoveryRouteActivation } from '~~/server/utils/enterpriseRecoveryRoute'

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, 'authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw createError({ statusCode: 401, message: 'Runtime control credential required' })
  const body = await readBody<RecoveryRouteActivation>(event)
  const allowed = ['tenantCode', 'environment', 'recoveryKey', 'preparationSha256', 'activationSha256', 'runtimeCode', 'generation']
  if (!body || Object.keys(body).some(key => !allowed.includes(key))) throw createError({ statusCode: 400, message: 'Invalid recovery activation fields' })
  try {
    return { success: true, data: await publishRecoveryRoute(body, authorization.slice(7)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw createError({ statusCode: message.includes('authentication_failed') ? 401 : message.startsWith('recovery_route_') ? 409 : 503, message: message.startsWith('recovery_route_') ? message : 'Recovery publication unavailable' })
  }
})
