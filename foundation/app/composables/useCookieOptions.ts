export function resolveCookieDomain(hostname: string): string | undefined {
  if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return undefined
  }

  const parts = hostname.split('.')
  if (parts.length >= 3) {
    return '.' + parts.slice(1).join('.')
  }

  if (parts.length === 2) {
    return '.' + hostname
  }

  return undefined
}

export function createCookieOptions(domain?: string): { path: string, sameSite: 'lax', domain?: string } {
  const opts: { path: string, sameSite: 'lax', domain?: string } = {
    path: '/',
    sameSite: 'lax'
  }

  if (domain) {
    opts.domain = domain
  }

  return opts
}

/**
 * SSO Cookie 配置工具
 * 自动从当前域名中提取顶级域名后缀作为 cookie domain
 * 例如：account.wiztek.cn → .wiztek.cn
 *       codocs.wiztek.cn  → .wiztek.cn
 * 这样两个应用的 Cookie 可以跨子域名共享，实现免登录。
 *
 * 本地开发时（localhost）不设置 domain，保持默认行为。
 */
export function useCookieOptions() {
  const getCookieDomain = (): string | undefined => {
    let hostname = ''

    if (import.meta.client) {
      hostname = window.location.hostname
    } else {
      // 服务端从请求头中获取
      try {
        const headers = useRequestHeaders(['host', 'x-forwarded-host'])
        const host = headers['x-forwarded-host'] || headers['host'] || ''
        // 去掉端口号
        hostname = String(host).split(':')[0] || ''
      } catch {
        return undefined
      }
    }

    return resolveCookieDomain(hostname)
  }

  const cookieDomain = getCookieDomain()

  /**
   * 返回用于 useCookie 的统一选项
   */
  const cookieOptions = (): { path: string, sameSite: 'lax', domain?: string } => {
    return createCookieOptions(cookieDomain)
  }

  return {
    cookieDomain,
    cookieOptions
  }
}
