/**
 * 头像路径解析工具
 *
 * 头像统一由 Console OSS 代理提供。浏览器端必须通过当前租户入口访问，
 * 以便租户网关注入 tenant-runtime；SSR 保持根相对 URL，由请求域名承载租户上下文。
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

export function resolveAvatarSrc(avatar: string | null | undefined): string | null {
  if (!avatar) return null

  // 已是完整 URL 或 data/blob URL
  if (avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('blob:')) {
    return avatar
  }

  // 已是租户入口代理 URL
  if (avatar.startsWith('/api/oss/avatar')) {
    return avatar
  }

  // OSS 相对路径 → 当前租户入口上的 Console 头像代理。
  return buildAvatarProxyUrl(getTenantGatewayOrigin(), avatar)
}

export function resolveAvatarProps(avatar: string | null | undefined) {
  const src = resolveAvatarSrc(avatar)
  return src ? { src } : {}
}
