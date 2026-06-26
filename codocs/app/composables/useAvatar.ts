/**
 * 统一头像路径解析。
 *
 * Codocs 仍保留本地封装，但解析策略已与 Foundation 对齐：
 * 非绝对路径头像统一走 Account 模块的头像代理，避免各业务模块各自依赖本地 OSS 配置。
 */
function getAccountBaseUrl(): string {
  try {
    const config = useRuntimeConfig()
    const pub = config.public as Record<string, unknown>
    if (pub.accountUrl) return String(pub.accountUrl).replace(/\/$/, '')
  } catch {
    // ignore
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

  const accountBase = getAccountBaseUrl()
  if (accountBase) {
    return buildAvatarProxyUrl(accountBase, normalizedPath)
  }

  return `/api/oss/avatar?path=${encodeURIComponent(normalizedPath)}&v=${encodeURIComponent(normalizedPath)}`
}

export function resolveAvatarProps(avatar: unknown): { src: string } | undefined {
  const src = resolveAvatarSrc(avatar)
  return src ? { src } : undefined
}
