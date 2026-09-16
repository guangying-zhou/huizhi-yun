function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function codocsUpstreamStatus(error: unknown) {
  const candidate = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.status || 0)
}

export function codocsUpstreamMessage(error: unknown, fallback = '') {
  const candidate = error as {
    message?: string
    statusMessage?: string
    data?: { message?: string, statusMessage?: string }
  }
  return stringValue(candidate?.data?.message)
    || stringValue(candidate?.data?.statusMessage)
    || stringValue(candidate?.message)
    || stringValue(candidate?.statusMessage)
    || fallback
}

export function shouldFallbackProjectCabinetUpload(error: unknown) {
  const status = codocsUpstreamStatus(error)
  if (status === 401 || status === 403 || status === 400) return false
  if (status >= 500 || status === 404 || status === 405 || status === 501) return true

  const message = codocsUpstreamMessage(error).toLowerCase()
  return message.includes('project_code')
    || message.includes('项目文件柜元数据')
    || message.includes('metadata')
    || message.includes('migration')
    || message.includes('schema')
    || message.includes('tenant-runtime')
    || message.includes('unknown column')
}
