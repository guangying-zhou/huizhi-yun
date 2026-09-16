import { defineEventHandler } from 'h3'
import { handleUpstreamOidcPostLogout } from '~~/server/utils/upstreamOidc'

export default defineEventHandler(async (event) => {
  return await handleUpstreamOidcPostLogout(event)
})
