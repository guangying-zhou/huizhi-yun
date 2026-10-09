import { getQuery } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

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
  await requirePermission(event, 'info', 'admin', '仅管理员可管理资讯书签')

  const data = await callCodocsTenantRuntime<BookmarkListData>(event, '/v1/codocs/info/bookmarks', {
    query: getQuery(event) as Record<string, unknown>,
    scope: 'codocs.read'
  })

  return {
    success: true,
    data
  }
})
