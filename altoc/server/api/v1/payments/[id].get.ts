export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Receivable plan detail reads must be handled by Altoc tenant-runtime.'
  })
})
