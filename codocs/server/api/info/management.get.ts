import { getQuery } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface BookmarkListData {
  items?: unknown[]
  pagination?: {
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
  }
}

export default defineEventHandler(async (event) => {
  const data = await callCodocsTenantRuntime<BookmarkListData>(event, '/v1/codocs/info/bookmarks', {
    query: getQuery(event) as Record<string, unknown>,
    scope: 'codocs.read'
  })

  return {
    success: true,
    data
  }
})
