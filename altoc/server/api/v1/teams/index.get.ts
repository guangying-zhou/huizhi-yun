export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Sales team list reads must be handled by Altoc tenant-runtime.'
  })
})
