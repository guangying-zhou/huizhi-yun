export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Sales team detail reads must be handled by Altoc tenant-runtime.'
  })
})
