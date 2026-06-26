/**
 * 头像路径解析工具
 *
 * 头像统一由 Account 模块提供，其他模块通过 Account URL 获取。
 * accountUrl 从 runtimeConfig.public.accountUrl 读取（客户端可用）。
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

function buildCurrentAppAvatarProxyUrl(avatarPath: string): string {
  const encodedPath = encodeURIComponent(avatarPath)
  const version = encodeURIComponent(avatarPath)
  return withCurrentAppBase(`api/oss/avatar?path=${encodedPath}&v=${version}`)
}

function withCurrentAppBase(path: string): string {
  try {
    const config = useRuntimeConfig()
    const baseURL = String(config.app?.baseURL || '/')
    if (baseURL === '/') return path.startsWith('/') ? path : `/${path}`
    if (path.startsWith(baseURL)) return path
    return `${baseURL}${path.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  } catch {
    return path.startsWith('/') ? path : `/${path}`
  }
}

export function resolveAvatarSrc(avatar: string | null | undefined): string | null {
  if (!avatar) return null

  // 已是完整 URL 或 data/blob URL
  if (avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('blob:')) {
    return avatar
  }

  // 已是代理 URL（本地或 Account）
  if (avatar.startsWith('/api/oss/avatar')) {
    return withCurrentAppBase(avatar)
  }

  // OSS 相对路径 → Account 头像接口
  const accountBase = getAccountBaseUrl()
  if (accountBase) {
    return buildAvatarProxyUrl(accountBase, avatar)
  }

  // fallback：本地代理（Account 模块自身使用）
  return buildCurrentAppAvatarProxyUrl(avatar)
}

export function resolveAvatarProps(avatar: string | null | undefined) {
  const src = resolveAvatarSrc(avatar)
  return src ? { src } : {}
}
