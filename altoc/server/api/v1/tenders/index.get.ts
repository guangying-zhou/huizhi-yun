export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender list reads must be handled by Altoc tenant-runtime.'
  })
})
