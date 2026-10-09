export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender updates must be handled by Altoc tenant-runtime.'
  })
})
