/**
 * 获取企业微信 JSSDK 配置
 * GET /api/wecom/jssdk-config?url=PAGE_URL
 *
 * 返回 wx.config 和 wx.agentConfig 所需的签名参数
 */
export default defineEventHandler(async (event) => {
  const { url } = getQuery<{ url: string }>(event)

  if (!url) {
    throw createError({ statusCode: 400, message: '缺少 url 参数' })
  }

  try {
    const config = await getJssdkConfig(url)
    return { code: 0, data: config }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 500, message })
  }
})
