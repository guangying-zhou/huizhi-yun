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

type ApplicationAccessIssue = 'person_permission_denied' | 'module_not_configured' | 'module_not_deployed' | 'service_unavailable' | 'enterprise_entitlement_inactive' | null

function errorDetails(errorValue: unknown) {
  const root = record(errorValue)
  const data = record(root.data)
  const body = record(data.data)
  const message = text(body.message) || text(data.message) || text(root.message) || text(root.statusMessage)
  const code = text(body.code) || text(data.code)
  const statusCode = Number(root.statusCode || data.statusCode || body.statusCode || data.upstreamStatus || 0)
  return { message, code, statusCode }
}

export function classifyApplicationAccessIssue(errorValue: unknown): ApplicationAccessIssue {
  const { message, code, statusCode } = errorDetails(errorValue)
  const searchable = `${message} ${code}`.toLowerCase()
  if (code === 'module_not_configured' || searchable.includes('runtime_binding_unavailable') || searchable.includes('not configured') || searchable.includes('未配置')) return 'module_not_configured'
  if (code === 'module_not_deployed' || searchable.includes('not-deployed') || searchable.includes('未部署')) return 'module_not_deployed'
  if (code === 'enterprise_entitlement_inactive' || code === 'enterprise_entitlement_invalid') return 'enterprise_entitlement_inactive'
  if (code === 'person_permission_denied' || code === 'permission_denied' || statusCode === 401 || statusCode === 403) return 'person_permission_denied'
  if (statusCode >= 500 || searchable.includes('unavailable') || searchable.includes('暂不可用')) return 'service_unavailable'
  return null
}

export function resolveApiErrorAlert(errorValue: unknown, options: ApiErrorAlertOptions = {}): ApiErrorAlert | null {
  if (!errorValue) return null

  const { message, code, statusCode } = errorDetails(errorValue)
  const searchable = `${message} ${code}`.toLowerCase()
  const appName = options.appName?.trim()
  const detail = sanitizedDetail(message)
  const issue = classifyApplicationAccessIssue(errorValue)

  if (issue === 'module_not_configured') {
    return { color: 'warning', icon: 'i-lucide-settings-2', title: appName ? `${appName} 尚未配置` : '模块尚未配置', description: detail || '请联系企业管理员完成模块配置；这不是购买资格限制。' }
  }

  if (issue === 'module_not_deployed') {
    return { color: 'warning', icon: 'i-lucide-box', title: appName ? `${appName} 尚未部署` : '模块尚未部署', description: detail || '企业已具备全量功能资格，但该模块尚未部署，暂不能进入。' }
  }

  if (issue === 'enterprise_entitlement_inactive') {
    return { color: 'warning', icon: 'i-lucide-building-2', title: '企业功能资格暂不可用', description: detail || '企业整体资格处于未生效、停用或失效状态；这不是单应用购买限制。' }
  }

  if (issue === 'person_permission_denied') {
    return {
      color: 'error',
      icon: 'i-lucide-shield-alert',
      title: appName ? `${appName} 访问权限不足` : '访问权限不足',
      description: detail || '请确认当前登录用户已获得对应资源权限。'
    }
  }

  if (issue === 'service_unavailable') {
    return { color: 'warning', icon: 'i-lucide-server-crash', title: appName ? `${appName} 服务暂不可用` : '服务暂不可用', description: detail || '请稍后重试；若问题持续，请联系企业管理员检查服务状态。' }
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
