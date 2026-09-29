import { createError, defineEventHandler, readBody } from 'h3'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { signedRecoveryRoutePreparation, type RecoveryRouteInput } from '~~/server/utils/enterpriseRecoveryRoute'

export default defineEventHandler(async (event) => {
  const actorUid = String(event.context.platformUid || '').trim()
  if (!actorUid) throw createError({ statusCode: 401, message: 'Authenticated operator required' })
  if (event.context.platformAccessScope !== 'ops' || !(await buildOpsAuthorizationSnapshot(actorUid)).resources['ops.deployments']?.includes('admin')) throw createError({ statusCode: 403, message: 'Deployment admin permission required' })
  const body = await readBody<Record<string, unknown>>(event)
  const allowed = ['mode', 'tenantCode', 'environment', 'recoveryKey', 'recoveryReviewHash', 'runtimeCode', 'workerDeployment', 'workerClient', 'generation', 'aimsSchema', 'assetsSchema', 'instanceId', 'databaseUser', 'databaseHost', 'expectedRevision', 'requestId']
  if (!body || Object.keys(body).some(key => !allowed.includes(key))) throw createError({ statusCode: 400, message: 'Invalid recovery preparation fields' })
  if (!body || !['plan', 'prepare'].includes(String(body.mode || 'plan'))) throw createError({ statusCode: 400, message: 'Invalid recovery preparation mode' })
  try {
    return { success: true, data: await signedRecoveryRoutePreparation({ ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'mode')), actorUid } as RecoveryRouteInput, body.mode === 'prepare') }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw createError({ statusCode: message.startsWith('recovery_route_') ? 409 : 503, message: message.startsWith('recovery_route_') ? message : 'Recovery preparation unavailable' })
  }
})
