/**
 * Requirement content creation is served by tenant-runtime/data-runtime.
 * This local handler is only a clear fallback when runtime proxying is disabled.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Aims tenant-runtime is required to create requirement content.'
  })
})
