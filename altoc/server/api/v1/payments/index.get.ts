export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Receivable plan list reads must be handled by Altoc tenant-runtime.'
  })
})
