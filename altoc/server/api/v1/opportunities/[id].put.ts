export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Opportunity updates must be handled by Altoc tenant-runtime.'
  })
})
