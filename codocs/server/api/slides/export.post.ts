/**
 * Slidev 导出 API（代理到 slidev-service）
 *
 * 支持导出为 PDF / PPTX / PNG。
 */
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'documents', 'export', '缺少文档导出权限')

  const body = await readBody(event)
  const { content, format, filename } = body || {}

  if (!content || typeof content !== 'string') {
    throw createError({ statusCode: 400, message: '缺少 content 参数' })
  }

  const config = useRuntimeConfig()
  const serviceUrl = config.slidevServiceUrl || 'http://localhost:3040'

  try {
    const res = await $fetch<{ success?: boolean, error?: string, data?: { url: string, filename: string } }>(`${serviceUrl}/export`, {
      method: 'POST',
      body: { content, format: format || 'pdf', filename: filename || 'slides' },
      timeout: 130_000
    })

    if (res.error) {
      throw createError({ statusCode: 500, message: res.error })
    }

    // 返回完整下载 URL（指向 slidev-service）
    return {
      success: true,
      data: {
        url: `${serviceUrl}${res.data?.url}`,
        filename: res.data?.filename
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, data?: { error?: string } }
    console.error('[Slides Export] Error:', error.message)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.data?.error || error.message || '导出失败'
    })
  }
})
