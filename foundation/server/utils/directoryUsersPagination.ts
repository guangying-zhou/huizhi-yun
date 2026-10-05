export const DIRECTORY_RUNTIME_MAX_PAGE_SIZE = 100
export const DIRECTORY_BFF_MAX_PAGE_SIZE = 1000

interface DirectoryUsersPage<T> {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
  tree?: unknown[]
  [key: string]: unknown
}

export interface DirectoryUsersEnvelope<T> {
  code: number
  message?: string
  success?: boolean
  data?: DirectoryUsersPage<T> | T[]
  [key: string]: unknown
}

function positiveInteger(value: unknown, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Preserve the Directory BFF's larger page window while respecting the
 * Console data-runtime limit of 100 rows per upstream request.
 */
export async function fetchPaginatedDirectoryUsers<T>(
  query: Record<string, unknown>,
  fetchPage: (params: Record<string, unknown>) => Promise<DirectoryUsersEnvelope<T>>
): Promise<DirectoryUsersEnvelope<T>> {
  const requestedPage = positiveInteger(query.page, 1)
  const requestedPageSize = Math.min(
    positiveInteger(query.pageSize ?? query.limit, 20),
    DIRECTORY_BFF_MAX_PAGE_SIZE
  )

  if (requestedPageSize <= DIRECTORY_RUNTIME_MAX_PAGE_SIZE) {
    return fetchPage(query)
  }

  const upstreamQuery = { ...query }
  delete upstreamQuery.page
  delete upstreamQuery.pageSize
  delete upstreamQuery.limit

  const startOffset = (requestedPage - 1) * requestedPageSize
  const endOffset = startOffset + requestedPageSize
  const firstUpstreamPage = Math.floor(startOffset / DIRECTORY_RUNTIME_MAX_PAGE_SIZE) + 1
  const firstResponse = await fetchPage({
    ...upstreamQuery,
    page: firstUpstreamPage,
    pageSize: DIRECTORY_RUNTIME_MAX_PAGE_SIZE
  })
  const firstData = firstResponse.data

  if (!firstData || Array.isArray(firstData) || firstResponse.code !== 0) {
    return firstResponse
  }

  const total = Math.max(0, Number(firstData.total) || 0)
  if (startOffset >= total) {
    return {
      ...firstResponse,
      data: {
        ...firstData,
        items: [],
        total,
        page: requestedPage,
        pageSize: requestedPageSize
      }
    }
  }

  const lastOffset = Math.min(endOffset, total)
  const lastUpstreamPage = Math.ceil(lastOffset / DIRECTORY_RUNTIME_MAX_PAGE_SIZE)
  const remainingPages = Array.from(
    { length: Math.max(0, lastUpstreamPage - firstUpstreamPage) },
    (_, index) => firstUpstreamPage + index + 1
  )
  const remainingResponses = await Promise.all(remainingPages.map(page => fetchPage({
    ...upstreamQuery,
    page,
    pageSize: DIRECTORY_RUNTIME_MAX_PAGE_SIZE
  })))

  const items = [...(firstData.items || [])]
  for (const response of remainingResponses) {
    if (response.code !== 0 || !response.data || Array.isArray(response.data)) {
      return response
    }
    items.push(...(response.data.items || []))
  }

  const offsetInFirstPage = startOffset % DIRECTORY_RUNTIME_MAX_PAGE_SIZE
  return {
    ...firstResponse,
    data: {
      ...firstData,
      items: items.slice(offsetInFirstPage, offsetInFirstPage + requestedPageSize),
      total,
      page: requestedPage,
      pageSize: requestedPageSize
    }
  }
}
