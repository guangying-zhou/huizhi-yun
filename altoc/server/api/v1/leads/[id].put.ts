export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Lead updates must be handled by Altoc tenant-runtime.'
  })
})
