export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Dashboard KPIs must be handled by Altoc tenant-runtime.'
  })
})
