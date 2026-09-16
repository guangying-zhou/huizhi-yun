/**
 * SSO Cookie 配置工具
 * 自动从 hostname 提取顶级域名作为 cookie domain，实现跨子域共享
 */
export function useCookieOptions() {
  function cookieOptions() {
    let domain: string | undefined

    if (import.meta.client) {
      const hostname = window.location.hostname
      if (hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        const parts = hostname.split('.')
        if (parts.length >= 2) {
          domain = '.' + parts.slice(-2).join('.')
        }
      }
    }

    return {
      path: '/',
      sameSite: 'lax' as const,
      ...(domain ? { domain } : {})
    }
  }

  return { cookieOptions }
}
