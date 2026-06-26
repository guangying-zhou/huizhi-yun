export default defineEventHandler((event) => {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: `API route not found: ${event.path}`
  })
})
