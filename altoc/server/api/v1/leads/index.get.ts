export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Lead reads must be handled by Altoc tenant-runtime.'
  })
})
