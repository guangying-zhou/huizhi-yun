import { readBody } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ManagementBody {
  action?: 'process' | 'ignore'
  ids?: string[]
  category?: 'news' | 'article' | 'auto'
}

interface RuntimeActionResult {
  message?: string
  updated?: number
  category?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ManagementBody>(event)
  const result = await callCodocsTenantRuntime<RuntimeActionResult>(event, '/v1/codocs/info/bookmarks/actions', {
    method: 'PUT',
    scope: 'codocs.write',
    body
  })

  if (body.action === 'process') {
    const config = useRuntimeConfig()
    const fetcherUrl = config.fetcher.baseUrl || 'http://localhost:8001'
    $fetch(`${fetcherUrl}/process`, {
      method: 'POST',
      body: {
        bookmark_ids: body.ids || [],
        category: body.category
      }
    }).catch((error) => {
      console.error('Background fetcher service failed:', error)
    })
  }

  return {
    success: true,
    message: result.message || (body.action === 'ignore' ? '已忽略选中的书签' : '处理任务已在后台启动'),
    data: {
      updated: result.updated || 0,
      category: result.category || body.category || null
    }
  }
})
