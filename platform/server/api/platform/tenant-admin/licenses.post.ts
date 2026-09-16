import licensesHandler from '~~/server/api/platform/_handlers/licenses.post'

export default defineEventHandler((event) => {
  const membership = event.context.platformTenantMembership

  if (!membership?.isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'only tenant owner can issue licenses'
    })
  }

  return licensesHandler(event)
})
