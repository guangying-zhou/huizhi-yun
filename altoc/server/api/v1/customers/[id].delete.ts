export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer deletes must be handled by Altoc tenant-runtime.'
  })
})
