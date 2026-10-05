import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { signCommittedCutoverActivation, type CutoverActivationInput } from '~~/server/utils/enterpriseCutoverActivation'
export default defineEventHandler(async event => {
  const auth = getHeader(event, 'authorization') || ''
  if (!auth.startsWith('Bearer ')) throw createError({ statusCode: 401, message: 'Runtime control credential required' })
  const input = await readBody<CutoverActivationInput>(event)
  try { return await signCommittedCutoverActivation(input, auth.slice(7)) } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw createError({ statusCode: message.includes('authentication_failed') ? 401 : message.startsWith('cutover_activation_') ? 409 : 503, message: message.startsWith('cutover_activation_') ? message : 'Cutover activation unavailable' })
  }
})
