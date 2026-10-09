import { createError } from 'h3'
import { requireVaultServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  await requireVaultServiceActor(event)
  throw createError({
    statusCode: 410,
    message: 'Service credential access moved to the tenant-runtime service integration API.'
  })
})
