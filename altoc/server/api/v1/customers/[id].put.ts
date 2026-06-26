export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer updates must be handled by Altoc tenant-runtime.'
  })
})
