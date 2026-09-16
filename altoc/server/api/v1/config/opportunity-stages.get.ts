export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Opportunity stage config reads must be handled by Altoc tenant-runtime.'
  })
})
