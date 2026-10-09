export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Contract invoice reads must be handled by Altoc tenant-runtime.'
  })
})
