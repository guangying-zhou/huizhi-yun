export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Quotation detail reads must be handled by Altoc tenant-runtime.'
  })
})
