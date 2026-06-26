export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Document link reads must be handled by Altoc tenant-runtime.'
  })
})
