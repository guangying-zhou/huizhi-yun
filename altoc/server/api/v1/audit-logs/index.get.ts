export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Audit log reads must be handled by Altoc tenant-runtime.'
  })
})
