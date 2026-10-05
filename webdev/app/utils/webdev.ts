// WebDev 控制台共享词汇：任务状态映射与格式化助手

export type WebdevBadgeColor = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary'

export type WebdevStatusMeta = {
  label: string
  color: WebdevBadgeColor
  icon: string
}

export const WEBDEV_STATUS_MAP: Record<string, WebdevStatusMeta> = {
  idle: { label: '未开始', color: 'neutral', icon: 'i-lucide-circle-dashed' },
  queued: { label: '排队中', color: 'neutral', icon: 'i-lucide-circle-dashed' },
  running: { label: '运行中', color: 'info', icon: 'i-lucide-loader-circle' },
  needs_approval: { label: '待确认', color: 'warning', icon: 'i-lucide-shield-question' },
  deploying: { label: '部署中', color: 'info', icon: 'i-lucide-rocket' },
  succeeded: { label: '已完成', color: 'success', icon: 'i-lucide-circle-check' },
  failed: { label: '失败', color: 'error', icon: 'i-lucide-circle-x' },
  canceled: { label: '已取消', color: 'warning', icon: 'i-lucide-circle-slash' }
}

const FALLBACK_STATUS: WebdevStatusMeta = { label: '未开始', color: 'neutral', icon: 'i-lucide-circle-dashed' }

export function webdevStatusMeta(status: string | undefined): WebdevStatusMeta {
  return WEBDEV_STATUS_MAP[String(status || '').toLowerCase()] || FALLBACK_STATUS
}

export function webdevFormatClock(value: string | undefined, withDate = true) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      ...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

export function webdevFormatDuration(started: number, finished: number) {
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-'
  const seconds = Math.max(0, Math.round((finished - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function webdevRelativeTime(value: string | undefined) {
  if (!value) return '-'
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return value
  const diff = Date.now() - ts
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  return `${days} 天前`
}
