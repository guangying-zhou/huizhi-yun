export type DirectoryLifecyclePreparationRow = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()

export async function prepareDueDirectoryLifecycleOperations(
  callRuntime: (path: string, body: DirectoryLifecyclePreparationRow) => Promise<DirectoryLifecyclePreparationRow>,
  options: { asOf?: string, limit?: number, maxPages?: number, deadlineAt?: number } = {}
) {
  const asOf = options.asOf || new Date().toISOString()
  const limit = Math.min(100, Math.max(1, options.limit || 20))
  const maxPages = Math.min(5, Math.max(1, options.maxPages || 5))
  let cursor = ''
  let pages = 0
  let created = 0
  let reused = 0
  let scanned = 0
  let failed = false
  let errorCode = ''
  while (pages < maxPages && (!options.deadlineAt || Date.now() < options.deadlineAt)) {
    let page: DirectoryLifecyclePreparationRow
    try {
      page = await callRuntime('/v1/people/service/directory-lifecycle:prepare-due', {
        asOf,
        limit,
        ...(cursor ? { cursor } : {})
      })
    } catch (error) {
      failed = true
      errorCode = text((error as { statusMessage?: unknown, message?: unknown }).statusMessage)
        || text((error as { message?: unknown }).message)
        || 'directory_lifecycle_prepare_failed'
      break
    }
    pages += 1
    created += Number(page.created || 0)
    reused += Number(page.reused || 0)
    scanned += Number(page.scanned || 0)
    const nextCursor = text(page.nextCursor)
    if (!nextCursor || nextCursor === cursor) break
    cursor = nextCursor
  }
  return { pages, created, reused, scanned, asOf, nextCursor: cursor, failed, errorCode }
}
