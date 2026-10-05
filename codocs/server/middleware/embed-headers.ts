/**
 * 为 /embed/ 路径设置允许 iframe 嵌入的响应头
 */
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (url.pathname.startsWith('/embed/')) {
    setResponseHeader(event, 'X-Frame-Options', 'ALLOWALL')
    // 移除可能的 CSP frame-ancestors 限制
    setResponseHeader(event, 'Content-Security-Policy', '')
  }
})
