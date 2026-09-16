/**
 * 统一头像路径解析。
 *
 * Codocs 仍保留本地封装，但解析策略已与 Foundation 对齐：
 * 浏览器端统一走当前租户入口的 Console 头像代理，避免绕开 tenant-runtime。
 */
function getTenantGatewayOrigin(): string {
  if (typeof window !== 'undefined') {
    const tenantOrigin = String(window.location?.origin || '').trim()
    if (tenantOrigin) return tenantOrigin.replace(/\/$/, '')
  }
  return ''
}

function buildAvatarProxyUrl(baseUrl: string, avatarPath: string): string {
  const encodedPath = encodeURIComponent(avatarPath)
  const version = encodeURIComponent(avatarPath)
  return `${baseUrl}/api/oss/avatar?path=${encodedPath}&v=${version}`
}

export function resolveAvatarSrc(avatar: unknown): string | undefined {
  if (typeof avatar !== 'string') return undefined

  const value = avatar.trim()
  if (!value || value === 'null' || value === 'undefined') return undefined

  if (
    value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('data:')
    || value.startsWith('blob:')
  ) {
    return value
  }

  if (value.startsWith('/api/oss/avatar?')) {
    return value
  }

  const normalizedPath = value
    .replace(/^\/+/, '')
    .replace(/^avatars\/+/, '')

  return buildAvatarProxyUrl(getTenantGatewayOrigin(), normalizedPath)
}

export function resolveAvatarProps(avatar: unknown): { src: string } | undefined {
  const src = resolveAvatarSrc(avatar)
  return src ? { src } : undefined
}
