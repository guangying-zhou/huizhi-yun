// Keep the same dynamic segment name as sibling application routes.
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    statusMessage: 'Gone',
    message: 'platform application secrets are deprecated; runtime trust is managed by tenant_runtime_credentials'
  })
})
