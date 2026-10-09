export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender agency reads must be handled by Altoc tenant-runtime.'
  })
})
