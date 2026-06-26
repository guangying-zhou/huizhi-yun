export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Sales team member creation must be handled by Altoc tenant-runtime.'
  })
})
