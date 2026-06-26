export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender milestone updates must be handled by Altoc tenant-runtime.'
  })
})
