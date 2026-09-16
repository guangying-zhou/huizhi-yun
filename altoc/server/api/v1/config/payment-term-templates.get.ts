export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Payment term template config reads must be handled by Altoc tenant-runtime.'
  })
})
