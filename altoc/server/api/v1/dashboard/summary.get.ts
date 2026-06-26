export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Dashboard summary reads must be handled by Altoc tenant-runtime.'
  })
})
