/**
 * Slidev 预览 API（代理到 slidev-service）
 *
 * 将请求转发到独立的 Slidev 渲染服务，返回预览 URL。
 */

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { content } = body || {}

  if (!content || typeof content !== 'string') {
    throw createError({ statusCode: 400, message: '缺少 content 参数' })
  }

  const config = useRuntimeConfig()
  const serviceUrl = config.slidevServiceUrl || 'http://localhost:3040'

  try {
    const res = await $fetch<{ success?: boolean, error?: string, data?: { url: string, port: number } }>(`${serviceUrl}/render`, {
      method: 'POST',
      body: { content },
      timeout: 40_000
    })

    if (res.error) {
      throw createError({ statusCode: 500, message: res.error })
    }

    return {
      success: true,
      data: res.data
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, data?: { error?: string } }
    console.error('[Slides Preview] Error:', error.message)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.data?.error || error.message || 'Slidev 渲染服务不可用'
    })
  }
})
