export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer detail reads must be handled by Altoc tenant-runtime.'
  })
})
