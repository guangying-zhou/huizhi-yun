export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage: 'Local attachment uploads are retired; use runtime-backed document links.'
  })
})
