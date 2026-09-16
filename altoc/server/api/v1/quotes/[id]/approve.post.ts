export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Quotation approval must be handled by Altoc tenant-runtime.'
  })
})
