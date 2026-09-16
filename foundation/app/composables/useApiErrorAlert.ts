import type { MaybeRefOrGetter } from 'vue'

export interface ApiErrorAlertOptions {
  appName?: string
  fallbackTitle?: string
  fallbackDescription?: string
}

export interface ApiErrorAlert {
  color: 'error' | 'warning'
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

function sanitizedDetail(value: string) {
  const message = value.replace(/https?:\/\/[^\s"'<>]+/g, '[已隐藏URL]')
  return message ? `实际错误：${message}` : ''
}

export function resolveApiErrorAlert(errorValue: unknown, options: ApiErrorAlertOptions = {}): ApiErrorAlert | null {
  if (!errorValue) return null

  const root = record(errorValue)
  const data = record(root.data)
  const message = text(data.message) || text(root.message) || text(root.statusMessage)
  const code = text(data.code)
  const statusCode = Number(root.statusCode || data.statusCode || data.upstreamStatus || 0)
  const searchable = `${message} ${code}`.toLowerCase()
  const appName = options.appName?.trim()
  const detail = sanitizedDetail(message)

  if (statusCode === 401 || statusCode === 403) {
    return {
      color: 'error',
      icon: 'i-lucide-shield-alert',
      title: appName ? `${appName} 访问权限不足` : '访问权限不足',
      description: detail || '请确认当前登录用户已获得对应资源权限。'
    }
  }

  if (searchable.includes('console authorization') || searchable.includes('/api/auth/permissions')) {
    return {
      color: 'warning',
      icon: 'i-lucide-shield-question',
      title: 'Console 权限服务暂不可用',
      description: detail || '请确认 Console 服务可访问，并已初始化当前应用授权。'
    }
  }

  if (searchable.includes('tenant-runtime') || searchable.includes('data-runtime') || searchable.includes('adapter')) {
    return {
      color: 'warning',
      icon: 'i-lucide-database-zap',
      title: appName ? `${appName} 数据服务暂不可用` : '数据服务暂不可用',
      description: detail || '请确认 tenant-runtime 可访问，并已初始化当前应用数据能力。'
    }
  }

  return {
    color: 'warning',
    icon: 'i-lucide-circle-alert',
    title: options.fallbackTitle || (appName ? `${appName} 数据加载失败` : '数据加载失败'),
    description: detail || options.fallbackDescription || '请稍后重试；若问题持续，请联系系统管理员。'
  }
}

export function useApiErrorAlert(error: MaybeRefOrGetter<unknown>, options: ApiErrorAlertOptions = {}) {
  return computed(() => resolveApiErrorAlert(toValue(error), options))
}
