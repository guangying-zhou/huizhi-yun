export default defineEventHandler(() => {
  throw createError({
    statusCode: 405,
    statusMessage: 'Method Not Allowed',
    message: 'tenant subjects are synchronized from Console; dashboard subject editing is disabled'
  })
})
