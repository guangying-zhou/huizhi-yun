export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Opportunity activities must be handled by Altoc tenant-runtime.'
  })
})
