/**
 * 获取 Slidev 示例文稿（代理到 slidev-service）
 */

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const serviceUrl = config.slidevServiceUrl || 'http://localhost:3040'

  try {
    const res = await $fetch<{ success?: boolean, error?: string, data?: { content: string } }>(`${serviceUrl}/demo`, {
      timeout: 5_000
    })
    return { success: true, data: res.data }
  } catch (err: unknown) {
    const error = err as { message?: string }
    throw createError({
      statusCode: 500,
      message: error.message || '获取示例失败'
    })
  }
})
