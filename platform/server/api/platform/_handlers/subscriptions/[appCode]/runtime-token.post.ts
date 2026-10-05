export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    statusMessage: 'Gone',
    message: 'subscription runtime token endpoint is deprecated; rotate tenant runtime token at /api/platform/ops/tenants/{tenantCode}/runtime-token or /api/platform/tenant-admin/runtime-token'
  })
})
