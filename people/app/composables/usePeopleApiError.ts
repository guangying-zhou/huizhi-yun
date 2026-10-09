import type { UiColor } from '~/types'

interface PeopleApiErrorAlertOptions {
  fallbackTitle?: string
  fallbackDescription?: string
}

interface PeopleApiErrorAlert {
  color: UiColor
  icon: string
  title: string
  description: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sanitizeApiErrorMessage(value: string) {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, '[已隐藏URL]')
}

function errorDetail(message: string) {
  const detail = sanitizeApiErrorMessage(message)
  return detail ? `实际错误：${detail}` : ''
}

export function resolvePeopleApiErrorAlert(errorValue: unknown, options: PeopleApiErrorAlertOptions = {}): PeopleApiErrorAlert | null {
  if (!errorValue) return null

  const root = record(errorValue)
  const data = record(root.data)
  const message = text(data.message) || text(root.message) || text(root.statusMessage)
  const code = text(data.code)
  const statusCode = Number(root.statusCode || data.statusCode || data.upstreamStatus || 0)
  const searchable = `${message} ${code}`.toLowerCase()
  const detail = errorDetail(message)

  if (statusCode === 401 || statusCode === 403) {
    return {
      color: 'error',
      icon: 'i-lucide-shield-alert',
      title: 'People 访问权限不足',
      description: detail || '请确认当前登录用户已获得对应 People 资源权限。'
    }
  }

  if (searchable.includes('/api/auth/permissions') || searchable.includes('console authorization') || searchable.includes('console request')) {
    return {
      color: 'warning',
      icon: 'i-lucide-shield-question',
      title: 'Console 权限服务暂不可用',
      description: detail || 'People 会先读取 Console 合并权限快照；请确认 Console 服务可访问，并已初始化 People 授权。'
    }
  }

  if (searchable.includes('tenant-runtime') || searchable.includes('data-runtime') || searchable.includes('runtime') || searchable.includes('adapter')) {
    return {
      color: 'warning',
      icon: 'i-lucide-database-zap',
      title: 'People data-runtime 暂不可用',
      description: detail || '请确认 People schema 已执行，HZY_PEOPLE_AGENT_ENABLED=true，且 People 应用可访问 tenant-runtime。'
    }
  }

  return {
    color: 'warning',
    icon: 'i-lucide-circle-alert',
    title: options.fallbackTitle || 'People 数据加载失败',
    description: detail || options.fallbackDescription || '请查看 People 服务端日志确认上游依赖状态。'
  }
}
