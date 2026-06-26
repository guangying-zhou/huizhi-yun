export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Config dictionary updates must be handled by Altoc tenant-runtime.'
  })
})
