/**
 * Account API (huizhi-yun统一用户管理) 客户端
 */
import { getAccountApiAuthHeaders, getAccountApiConfig } from '~~/server/utils/accountApiConfig'

interface AccountUser {
  id: number
  uid: string
  realName: string
  nickname: string | null
  email: string
  mobile?: string | null
  avatar: string | null
  gender?: number
  status: number
  deptCode?: string | null
  deptName?: string | null
  department?: {
    id: number
    name: string
    code: string
  }
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

interface LoginAuditPayload {
  uid?: string | null
  targetApp?: string
  loginType: 'password' | 'sso' | 'oauth'
  loginResult: 0 | 1
  failureReason?: string | null
  sessionId?: string | null
  ipAddress?: string | null
  device?: string | null
  browser?: string | null
  os?: string | null
}

interface OperationAuditPayload {
  sourceApp?: string
  sessionId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | number | null
  detail?: string | Record<string, unknown> | null
  result?: 'success' | 'failed'
  operatorUid?: string | null
  operatorUserId?: number | null
}

/**
 * 通过邮箱搜索用户
 */
export async function getUserByEmail(email: string): Promise<AccountUser | null> {
  const { apiBaseUrl, apiKey, apiSecret } = getAccountApiConfig()

  if (!apiKey || !apiSecret) {
    console.warn('[AccountApi] API key or secret not configured')
    return null
  }

  try {
    const response = await $fetch<ApiResponse<{
      items: AccountUser[]
      total: number
    }>>(
      `${apiBaseUrl}/api/v1/users`,
      {
        params: { search: email },
        headers: getAccountApiAuthHeaders(),
        timeout: 5000
      }
    )

    if (response.code === 0 && response.data?.items?.length) {
      const matched = response.data.items.find(
        u => u.email?.toLowerCase() === email.toLowerCase()
      )
      return matched || null
    }

    return null
  } catch (error: unknown) {
    console.error('[AccountApi] Error fetching user by email:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 通过 uid 获取用户详情
 */
export async function getUserByUid(uid: string): Promise<AccountUser | null> {
  const { apiBaseUrl, apiKey, apiSecret } = getAccountApiConfig()

  if (!apiKey || !apiSecret) {
    console.warn('[AccountApi] API key or secret not configured')
    return null
  }

  try {
    const response = await $fetch<ApiResponse<AccountUser>>(
      `${apiBaseUrl}/api/v1/users/${encodeURIComponent(uid)}`,
      {
        headers: getAccountApiAuthHeaders(),
        timeout: 5000
      }
    )

    if (response.code === 0 && response.data) {
      return response.data
    }

    console.warn('[AccountApi] Failed to get user:', response.message)
    return null
  } catch (error: unknown) {
    console.error('[AccountApi] Error fetching user:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function reportLoginAudit(payload: LoginAuditPayload): Promise<void> {
  const { apiBaseUrl, apiKey, apiSecret } = getAccountApiConfig()

  if (!apiKey || !apiSecret) {
    console.warn('[AccountApi] API key or secret not configured, skip login audit report')
    return
  }

  try {
    await $fetch<ApiResponse<null>>(`${apiBaseUrl}/api/v1/login-logs`, {
      method: 'POST',
      headers: getAccountApiAuthHeaders(),
      body: payload,
      timeout: 5000
    })
  } catch (error: unknown) {
    console.error('[AccountApi] Error reporting login audit:', error instanceof Error ? error.message : error)
  }
}

export async function reportOperationAudit(payload: OperationAuditPayload): Promise<void> {
  const { apiBaseUrl, apiKey, apiSecret } = getAccountApiConfig()

  if (!apiKey || !apiSecret) {
    console.warn('[AccountApi] API key or secret not configured, skip operation audit report')
    return
  }

  try {
    const appName = (useRuntimeConfig().public?.appName as string) || 'repoinsight'
    await $fetch<ApiResponse<null>>(`${apiBaseUrl}/api/v1/operation-logs`, {
      method: 'POST',
      headers: getAccountApiAuthHeaders(),
      body: {
        sourceApp: payload.sourceApp || appName,
        sessionId: payload.sessionId || null,
        action: payload.action,
        targetType: payload.targetType || null,
        targetId: payload.targetId ?? null,
        detail: payload.detail || null,
        result: payload.result || 'success',
        operatorUid: payload.operatorUid || null,
        operatorUserId: payload.operatorUserId ?? null
      },
      timeout: 5000
    })
  } catch (error: unknown) {
    console.error('[AccountApi] Error reporting operation audit:', error instanceof Error ? error.message : error)
  }
}
