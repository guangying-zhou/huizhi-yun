type UnknownRecord = Record<string, unknown>

export interface WorkflowProxyErrorData {
  statusCode: number
  statusMessage: string
  code: string
  message: string
  upstreamStatus: number
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object'
    ? value as UnknownRecord
    : {}
}

function finiteStatus(...values: unknown[]) {
  for (const value of values) {
    const status = Number(value)
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  return 0
}

function safeCode(value: unknown) {
  const code = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : ''
}

function safeMessage(value: unknown) {
  const message = typeof value === 'string' ? value.trim() : ''
  return message ? message.slice(0, 256) : ''
}

function clientStatusMessage(statusCode: number) {
  const messages: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    410: 'Gone',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests'
  }
  return messages[statusCode] || 'Workflow request failed'
}

/**
 * Preserve safe Workflow business errors while preventing upstream 5xx details
 * from leaking through an application proxy.
 */
export function workflowProxyErrorData(error: unknown): WorkflowProxyErrorData {
  const outer = asRecord(error)
  const response = asRecord(outer.response)
  const body = asRecord(outer.data)
  const business = asRecord(body.data)
  const bodyError = asRecord(body.error)
  const upstreamStatus = finiteStatus(
    outer.status,
    outer.statusCode,
    response.status,
    response.statusCode,
    body.statusCode,
    business.upstreamStatus
  )

  if (upstreamStatus >= 400 && upstreamStatus < 500) {
    const code = safeCode(business.code)
      || safeCode(bodyError.code)
      || safeCode(body.code)
      || `workflow_upstream_${upstreamStatus}`
    const message = safeMessage(business.message)
      || safeMessage(bodyError.message)
      || safeMessage(body.message)
      || '工作流请求未通过'

    return {
      statusCode: upstreamStatus,
      statusMessage: clientStatusMessage(upstreamStatus),
      code,
      message,
      upstreamStatus
    }
  }

  return {
    statusCode: 503,
    statusMessage: 'Workflow unavailable',
    code: 'workflow_upstream_unavailable',
    message: 'Workflow 服务暂时不可用',
    upstreamStatus
  }
}
