/**
 * Account API 调用工具
 *
 * 读取 runtimeConfig.hzy 中的 Account API 配置，
 * 由各模块通过 nuxt.config.ts 注入：
 *   hzy.apiBaseUrl / hzy.apiKey / hzy.apiSecret
 *
 * Legacy Auth Bridge:
 * 该文件服务于旧 `foundation -> account` 平台依赖，不是未来 `hzy_platform`
 * 的主 client 协议实现。后续若构建统一平台 client，应在新目录中独立实现。
 */

import { getHeader, type H3Event } from 'h3'
import type { AccountUser } from '../../app/types/account'
import { resolveConsoleRuntimeBaseUrl } from './consoleRuntime'
import { requestServiceAccessToken } from './serviceOidc'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    if (current !== undefined && current !== null && stringValue(current)) {
      return stringValue(current)
    }
  }

  return ''
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function resolveConsoleAuditBaseUrl(config: Record<string, unknown>) {
  return trimTrailingSlash(getConfigValue(config, [
    'hzy.audit.consoleApiUrl',
    'hzy.integration.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.consoleApiUrl',
    'hzy.consoleUrl',
    'public.consoleUrl'
  ]) || process.env.HZY_CONSOLE_API_URL || process.env.HZY_CONSOLE_URL || resolveConsoleRuntimeBaseUrl(config) || '')
}

async function fetchConsoleAuditApi<T>(path: string, body: Record<string, unknown>) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const baseUrl = resolveConsoleAuditBaseUrl(config)
  if (!baseUrl) {
    throw new Error('Console audit API is not configured')
  }

  const accessToken = await requestServiceAccessToken({
    audience: 'audit',
    scope: 'audit:write'
  })

  return await $fetch<T>(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body,
    timeout: 5000
  })
}

export function getAccountApiConfig() {
  const config = useRuntimeConfig()
  const runtimeConfig = config as {
    hzy?: {
      apiBaseUrl?: string
      apiKey?: string
      apiSecret?: string
    }
  }
  const hzy = runtimeConfig.hzy as {
    apiBaseUrl?: string
    apiKey?: string
    apiSecret?: string
  } | undefined

  return {
    apiBaseUrl: hzy?.apiBaseUrl || '',
    apiKey: hzy?.apiKey || '',
    apiSecret: hzy?.apiSecret || ''
  }
}

export function requireAccountApiConfig() {
  const config = getAccountApiConfig()
  if (!config.apiBaseUrl || !config.apiKey || !config.apiSecret) {
    throw createError({
      statusCode: 500,
      message: 'Account API configuration is missing (hzy.apiBaseUrl/apiKey/apiSecret)'
    })
  }
  return config as { apiBaseUrl: string, apiKey: string, apiSecret: string }
}

export function getAccountApiAuthHeaders() {
  const { apiKey, apiSecret } = requireAccountApiConfig()
  return {
    Authorization: `Bearer ${apiKey}:${apiSecret}`
  }
}

export function getRequestIp(event: H3Event): string | null {
  const forwardedFor = getHeader(event, 'x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null
  }
  const realIp = getHeader(event, 'x-real-ip')
  if (realIp) return realIp
  return event.node.req.socket.remoteAddress || null
}

/**
 * 调用 Account API
 */
export async function fetchAccountApi<T = unknown>(path: string, options?: { params?: Record<string, unknown> }): Promise<T> {
  const { apiBaseUrl } = requireAccountApiConfig()
  const response = await $fetch<T>(`${apiBaseUrl}${path}`, {
    headers: getAccountApiAuthHeaders(),
    timeout: 10000,
    ...options
  })
  return response as T
}

export async function getUserByUid(uid: string): Promise<AccountUser | null> {
  try {
    const response = await fetchAccountApi<ApiResponse<AccountUser>>(
      `/api/v1/users/${encodeURIComponent(uid)}`
    )

    if (response.code === 0 && response.data) {
      return response.data
    }

    console.warn('[Foundation.getUserByUid] failed:', response.message)
    return null
  } catch (error: unknown) {
    console.error('[Foundation.getUserByUid] error:', getErrorMessage(error))
    return null
  }
}

/**
 * 审计日志回传 payload
 *
 * 对应 Console 端 `POST /api/v1/operation-logs` 接口。
 * 所有业务模块应通过此 helper 将关键操作日志异步上报到 Console，
 * 由 Console 集中存储供企业侧统一审计视图查询。
 */
export interface OperationAuditPayload {
  /** 来源模块编码，如 'altoc' / 'aims'；不传默认读取 runtimeConfig.public.appName */
  sourceApp?: string
  sessionId?: string | null
  /** 操作标识，建议使用 `<module>.<entity>.<action>` 形式，如 'altoc.customer.create' */
  action: string
  /** 目标对象类型，如 'customer' / 'opportunity' */
  targetType?: string | null
  /** 目标对象 ID */
  targetId?: string | number | null
  /** 扩展信息，可传任意 JSON */
  detail?: string | Record<string, unknown> | null
  result?: 'success' | 'failed'
  operatorUid?: string | null
  operatorUserId?: number | null
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

/**
 * 异步上报操作审计日志到 Console（fire-and-forget 风格）
 *
 * - 通过 Console service token 鉴权，要求 `audit:write`
 * - 调用失败只打 error，不抛异常，不影响本地主流程
 * - 默认 sourceApp 取自 runtimeConfig.public.appName
 *
 * 使用建议：业务 API 在本地 `writeAuditLog` 写库成功后立即调用，
 * 不要 `await`，避免阻塞主请求 —— 例如：
 *
 * ```ts
 * await writeAuditLog({ ... })  // 本地写入（必须成功）
 * reportOperationAudit({        // 回传到 Console（不阻塞）
 *   action: 'altoc.customer.create',
 *   targetType: 'customer',
 *   targetId: id,
 *   operatorUid: user.uid,
 *   detail: { name }
 * }).catch(() => {})
 * ```
 */
export async function reportOperationAudit(payload: OperationAuditPayload): Promise<void> {
  try {
    const runtimeConfig = useRuntimeConfig() as unknown as {
      public?: { appCode?: string, appName?: string }
    }
    const appName = runtimeConfig.public?.appCode || runtimeConfig.public?.appName || 'external'

    await fetchConsoleAuditApi<ApiResponse<null>>('/api/v1/operation-logs', {
      sourceApp: payload.sourceApp || appName,
      sessionId: payload.sessionId || null,
      action: payload.action,
      targetType: payload.targetType || null,
      targetId: payload.targetId ?? null,
      detail: payload.detail || null,
      result: payload.result || 'success',
      operatorUid: payload.operatorUid || null,
      operatorUserId: payload.operatorUserId ?? null
    })
  } catch (error: unknown) {
    console.error('[Foundation.reportOperationAudit] failed:', getErrorMessage(error))
  }
}

export async function reportLoginAudit(payload: LoginAuditPayload): Promise<void> {
  try {
    await fetchConsoleAuditApi<ApiResponse<null>>('/api/v1/login-logs', { ...payload })
  } catch (error: unknown) {
    console.error('[Foundation.reportLoginAudit] failed:', getErrorMessage(error))
  }
}
