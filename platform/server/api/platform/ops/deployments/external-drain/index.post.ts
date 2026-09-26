import { createError, defineEventHandler, readBody } from 'h3'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { approveExternalDrain } from '~~/server/utils/enterpriseExternalDrainApproval'
export default defineEventHandler(async event => {
  const actor = String(event.context.platformUid || '')
  if (!actor) throw createError({ statusCode:401,message:'Authenticated operator required' })
  if (event.context.platformAccessScope !== 'ops' || !(await buildOpsAuthorizationSnapshot(actor)).resources['ops.deployments']?.includes('admin')) throw createError({statusCode:403,message:'Deployment admin permission required'})
  const body = await readBody(event)
  if (!body || !['plan','approve'].includes(body.mode || 'plan')) throw createError({statusCode:400,message:'Invalid review mode'})
  try { return await approveExternalDrain(body,actor,body.mode==='approve') } catch(error) { const message=error instanceof Error?error.message:''; throw createError({statusCode:message.startsWith('external_drain_')?409:503,message:message.startsWith('external_drain_')?message:'External evidence approval unavailable'}) }
})
