export interface TenantRuntimeErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export function tenantRuntimeErrorData(error: {
  status?: number
  statusCode?: number
  data?: TenantRuntimeErrorEnvelope
}, fallbackMessage = 'Tenant Runtime request failed') {
  const upstreamStatus = Number(error.statusCode || error.status || 0)
  const statusCode = upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502
  const code = stringValue(error.data?.error?.code)
  const message = stringValue(error.data?.error?.message) || fallbackMessage
  return {
    statusCode,
    code,
    message,
    upstreamStatus: upstreamStatus || statusCode
  }
}
