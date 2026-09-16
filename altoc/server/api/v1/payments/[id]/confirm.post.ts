export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Receivable payment confirmation must be handled by Altoc tenant-runtime.'
  })
})
