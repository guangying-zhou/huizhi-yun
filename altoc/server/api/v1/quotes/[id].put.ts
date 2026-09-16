export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Quotation updates must be handled by Altoc tenant-runtime.'
  })
})
