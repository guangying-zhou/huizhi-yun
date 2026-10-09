import index from './index.html'
import guide from './employee-guide.html'

export default {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('此站点仅提供系统迁移说明。', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const path = new URL(request.url).pathname
    const body = path === '/employee-guide.html' ? guide : index
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"
      }
    })
  }
}
