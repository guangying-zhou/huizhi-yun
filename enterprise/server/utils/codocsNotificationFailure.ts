/** Closed diagnostic projection: never log error messages, payloads or identities. */
const knownCodes = new Set([
  'notification_delivery_failed', 'insufficient_scope', 'permission_denied',
  'hzy0_upstream_error', 'service_token_invalid', 'service_token_expired',
  'service_binding_mismatch', 'tenant_binding_mismatch', 'deployment_binding_mismatch',
  'wecom_send_error', 'wecom_send_http_error', 'wecom_send_response_invalid', 'wecom_send_request_failed',
  'wecom_token_error', 'wecom_token_http_error', 'wecom_config_incomplete', 'wecom_secret_unconfigured',
  'console_exchange_policy_mismatch', 'notification_input_invalid', 'idempotency_conflict'
])

function diagnostic(stage: string, reason: unknown) {
  const error = reason && typeof reason === 'object' ? reason as Record<string, unknown> : {}
  const data = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : {}
  const response = error.response && typeof error.response === 'object' ? error.response as Record<string, unknown> : {}
  const status = Number(error.statusCode ?? error.status ?? response.status)
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {}
  const rawCode = typeof data.code === 'string' ? data.code : nested.error ?? error.code
  return {
    stage,
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    errorCode: typeof rawCode === 'string' && knownCodes.has(rawCode) ? rawCode : 'unknown'
  }
}

export function codocsNotificationFailureDiagnostics(reason: unknown) {
  const error = reason && typeof reason === 'object' ? reason as Record<string, unknown> : {}
  const result = error.result && typeof error.result === 'object' ? error.result as Record<string, unknown> : {}
  const rows = []
  for (const [key, stage] of [['inApp', 'notification_in_app'], ['external', 'notification_external']] as const) {
    const channel = result[key] && typeof result[key] === 'object' ? result[key] as Record<string, unknown> : {}
    if (channel.status === 'rejected') rows.push(diagnostic(stage, channel.reason))
  }
  return rows.length ? rows : [diagnostic('notification_dispatch', reason)]
}
