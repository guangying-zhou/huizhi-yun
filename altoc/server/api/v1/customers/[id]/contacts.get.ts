export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Customer contact reads must be handled by Altoc tenant-runtime.'
  })
})
