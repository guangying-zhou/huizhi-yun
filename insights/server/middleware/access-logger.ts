/**
 * 访问日志中间件
 * 记录用户实际访问的URL
 */

export default defineEventHandler(async (event) => {
  // 跳过静态资源和API请求的详细日志
  if (
    event.node.req.url?.startsWith('/_nuxt/')
    || event.node.req.url?.includes('.css')
    || event.node.req.url?.includes('.js')
    || event.node.req.url?.includes('.ico')
    || event.node.req.url?.includes('.png')
    || event.node.req.url?.includes('.jpg')
    || event.node.req.url?.includes('.svg')
    || event.node.req.url?.includes('.php')
    || event.node.req.url?.includes('/wp-')
    || event.node.req.url?.includes('/.env')
  ) {
    return
  }

  const host = getHeader(event, 'host')
  const protocol = getHeader(event, 'x-forwarded-proto') || 'https'
  const actualUserUrl = `${protocol}://${host}${event.node.req.url}`

  console.log(`[Access Log] ${event.node.req.method} ${actualUserUrl}`)
})
