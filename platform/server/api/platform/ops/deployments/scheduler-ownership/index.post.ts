import { createError, defineEventHandler, readBody } from 'h3'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { readSchedulerOwnership, registerSchedulerOwnership, type SchedulerOwnershipInput } from '~~/server/utils/tenantSchedulerOwnership'

export default defineEventHandler(async (event) => {
  const actorUid = String(event.context.platformUid || '').trim()
  if (!actorUid) throw createError({ statusCode: 401, message: 'Authenticated operator required' })
  if (event.context.platformAccessScope !== 'ops' || !(await buildOpsAuthorizationSnapshot(actorUid)).resources['ops.deployments']?.includes('admin')) throw createError({ statusCode: 403, message: 'Deployment admin permission required' })
  const body = await readBody<Record<string, unknown>>(event)
  const allowed = ['mode', 'storage', 'tenantCode', 'environment', 'runtimeCode', 'workerDeployment', 'workerClient', 'generation', 'expectedRevision', 'requestId', 'verificationReference', 'verificationSha256', 'verificationMethod']
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw createError({ statusCode: 400, message: 'Invalid scheduler ownership fields' })
  const mode = body.mode || 'plan'
  if (!['plan', 'verify', 'attest'].includes(String(mode))) throw createError({ statusCode: 400, message: 'Invalid scheduler ownership mode' })
  if (mode === 'verify') {
    if (typeof body.tenantCode !== 'string' || !['prod', 'test'].includes(String(body.environment))) throw createError({ statusCode: 400, message: 'Tenant and environment required' })
    return { success: true, data: { registration: await readSchedulerOwnership(body.tenantCode, String(body.environment)), runtimeEvidenceAutomaticallyVerified: false } }
  }
  try {
    return { success: true, data: await registerSchedulerOwnership({ ...body, actorUid } as SchedulerOwnershipInput, mode === 'attest') }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw createError({ statusCode: message.startsWith('scheduler_ownership_') ? 409 : 503, message: message.startsWith('scheduler_ownership_') ? message : 'Scheduler ownership unavailable' })
  }
})
