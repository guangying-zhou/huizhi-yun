import { defineEventHandler } from 'h3'
import { ensureCurrentSigningKey, getPublishedJwks } from '~~/server/utils/oidc'

export default defineEventHandler(async (event) => {
  await ensureCurrentSigningKey(event)
  return getPublishedJwks()
})
