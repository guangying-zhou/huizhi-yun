/**
 * Legacy Codocs data endpoint.
 *
 * Direct database access from Codocs server is disabled; add a tenant-runtime
 * contract before re-enabling this route.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Codocs tenant-runtime contract is required for this legacy data endpoint.'
  })
})
