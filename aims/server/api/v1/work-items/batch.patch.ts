/**
 * Work item batch updates are served by tenant-runtime/data-runtime.
 * This local handler is only a defensive fallback when runtime forwarding is unavailable.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Aims tenant-runtime is required to update work items in batch.'
  })
})
