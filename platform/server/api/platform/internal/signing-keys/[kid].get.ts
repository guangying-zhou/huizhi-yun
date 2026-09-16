import { ok, requireString } from '~~/server/utils/api'
import { findPlatformSigningKeyByKid } from '~~/server/utils/platformSigning'

const TRUSTED_SIGNING_KEY_STATUSES = new Set(['active', 'rotated'])

export default defineEventHandler(async (event) => {
  if (event.context.platformAccessScope !== 'internal') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'internal access required'
    })
  }

  const kid = requireString(getRouterParam(event, 'kid'), 'kid')
  const key = await findPlatformSigningKeyByKid(kid)

  if (!key || key.revokedAt || !TRUSTED_SIGNING_KEY_STATUSES.has(key.status)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `platform signing key not found: kid=${kid}`
    })
  }

  return ok({
    kid: key.kid,
    alg: key.alg,
    publicKey: key.publicKey,
    status: key.status,
    activatedAt: key.activatedAt,
    rotatedAt: key.rotatedAt
  })
})
