/**
 * 获取 Slidev 当前编辑内容（代理到 slidev-service）
 *
 * 用户在 Slidev 内置编辑器中修改后，通过此 API 读回最新内容。
 */

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const serviceUrl = config.slidevServiceUrl || 'http://localhost:3040'

  try {
    const res = await $fetch<{ success?: boolean, error?: string, data?: { content: string } }>(`${serviceUrl}/content`, {
      timeout: 5_000
    })

    if (res.error) {
      throw createError({ statusCode: 500, message: res.error })
    }

    return { success: true, data: res.data }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '获取内容失败'
    })
  }
})
