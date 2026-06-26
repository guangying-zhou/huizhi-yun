export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer list reads must be handled by Altoc tenant-runtime.'
  })
})
