export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Tender member creation must be handled by Altoc tenant-runtime.'
  })
})
