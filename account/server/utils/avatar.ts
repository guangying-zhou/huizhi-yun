/**
 * 标准化头像字段输出。
 * - 完整 URL（微信头像等）→ 原样返回
 * - OSS 路径 → 取最后一段文件名
 * - 空值 → null
 */
export function normalizeAvatarOutput(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  // 完整 URL 直接返回
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar
  }
  // OSS 路径取文件名
  return avatar.split('/').pop() || null
}
