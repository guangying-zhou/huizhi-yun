export default defineEventHandler(() => {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'tenant-admin cannot create tenants'
  })
})
