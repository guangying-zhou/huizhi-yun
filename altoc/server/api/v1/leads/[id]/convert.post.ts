export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Lead conversion must be handled by Altoc tenant-runtime.'
  })
})
