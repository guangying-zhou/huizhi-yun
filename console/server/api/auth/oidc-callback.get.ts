import { defineEventHandler } from 'h3'
import { handleUpstreamOidcCallback } from '~~/server/utils/upstreamOidc'
import { redirectLoginFailure } from '~~/server/utils/loginFailure'

export default defineEventHandler(async (event) => {
  try {
    return await handleUpstreamOidcCallback(event)
  } catch (error) {
    return redirectLoginFailure(event, error)
  }
})
