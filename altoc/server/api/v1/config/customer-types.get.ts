export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer type config reads must be handled by Altoc tenant-runtime.'
  })
})
