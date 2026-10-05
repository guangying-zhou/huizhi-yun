import { getQuery } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { withCurrentAppBase } from '~~/server/utils/appPath'

interface InfoListItem {
  id: number
  title: string
  category: string
  summary: string | null
  author: string | null
  published_at: string
  cover_image: string | null
  view_count?: number
  [key: string]: unknown
}

interface InfoListData {
  items?: InfoListItem[]
  pagination?: {
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
  }
  last_updated?: string | null
}

export default defineEventHandler(async (event) => {
  const data = await callCodocsTenantRuntime<InfoListData>(event, '/v1/codocs/info/list', {
    query: getQuery(event) as Record<string, unknown>,
    scope: 'codocs.read'
  })

  return {
    success: true,
    data: {
      ...data,
      items: (data.items || []).map(item => ({
        ...item,
        cover_image: withCurrentAppBase(event, item.cover_image)
      }))
    }
  }
})
