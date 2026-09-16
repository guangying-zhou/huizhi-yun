export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Sales team member deletes must be handled by Altoc tenant-runtime.'
  })
})
