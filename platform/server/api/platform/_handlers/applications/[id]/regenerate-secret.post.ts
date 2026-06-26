export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    statusMessage: 'Gone',
    message: 'platform application secrets are deprecated; runtime trust is managed by tenant_runtime_credentials'
  })
})
