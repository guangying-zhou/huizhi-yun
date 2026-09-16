export default defineEventHandler(() => {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'tenant-admin cannot patch tenant profile through this endpoint'
  })
})
