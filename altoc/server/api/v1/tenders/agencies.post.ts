export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender agency creation must be handled by Altoc tenant-runtime.'
  })
})
