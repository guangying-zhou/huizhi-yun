/**
 * 启动书签同步任务（管理员用）
 * 路由: POST /api/info/sync
 *
 * 由 Nitro 服务端转发到 fetcher 服务，避免浏览器直接请求外部地址导致 mixed content。
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const fetcherBaseUrl = config.fetcher.baseUrl || 'http://localhost:8001'

  try {
    interface SyncResponse {
      message?: string
      [key: string]: unknown
    }

    const response = await $fetch<SyncResponse>(`${fetcherBaseUrl}/sync`, {
      method: 'POST'
    })

    return {
      success: true,
      message: response?.message || '同步任务已启动',
      data: response ?? null
    }
  } catch (error: unknown) {
    console.error('[Info] Failed to start bookmark sync:', error)
    const errorDataMessage = typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { message?: unknown } }).data?.message
      : undefined
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '同步服务暂时不可用'
    throw createError({
      statusCode: 502,
      message: String(errorDataMessage || errorMessage || '同步服务暂时不可用')
    })
  }
})
