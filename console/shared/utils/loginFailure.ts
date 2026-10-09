export const loginFailureMessages = {
  account_inactive: '账号未启用或不在组织目录中，请联系管理员',
  identity_conflict: '账号绑定信息不一致，请联系管理员',
  login_expired: '登录验证已过期或已使用，请重新登录',
  verification_failed: '身份验证未通过，请重新登录',
  access_denied: '账号暂时无法访问此应用，请联系管理员',
  service_unavailable: '登录服务暂时不可用，请稍后重试',
  invalid_request: '登录请求无效，请重新登录',
  login_failed: '登录未完成，请重试或联系管理员'
} as const
export type LoginFailureReason = keyof typeof loginFailureMessages

export function loginFailureReason(error: unknown): LoginFailureReason {
  const value = error as { statusCode?: number, status?: number, data?: { code?: string, data?: { code?: string } } }
  const code = value?.data?.code || value?.data?.data?.code || ''
  if (['directory_identity_user_not_found', 'directory_identity_inactive'].includes(code)) return 'account_inactive'
  if (code === 'directory_identity_provider_conflict') return 'identity_conflict'
  if (/^console_external_login_(state_invalid|state_expired|state_consumed|binding_mismatch)$/.test(code)) return 'login_expired'
  const status = Number(value?.statusCode || value?.status)
  if (status === 503 || status === 502) return 'service_unavailable'
  if (status === 401) return 'verification_failed'
  if (status === 403) return 'access_denied'
  if (status === 400) return 'invalid_request'
  return 'login_failed'
}

export function publicLoginFailure(reason: unknown) {
  return typeof reason === 'string' && Object.hasOwn(loginFailureMessages, reason)
    ? loginFailureMessages[reason as LoginFailureReason]
    : loginFailureMessages.login_failed
}
export function publicLoginRequestId(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) ? value : ''
}
