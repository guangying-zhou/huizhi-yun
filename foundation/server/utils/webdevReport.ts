import { createError, getHeader, type H3Event } from 'h3'

// 业务应用 → WebDev Issue 上报代理：统一走 Console service token，不持有 WebDev 凭证。
// 详见 webdev/docs/WebDev-Issue-Inbox-Design.md（阶段 2）。

const WEBDEV_APP_CODE = 'webdev'
const ISSUE_WRITE_SCOPE = 'webdev:issue:write'
const ISSUE_READ_SCOPE = 'webdev:issue:read'
const TENANT_CONTEXT_HEADER_NAMES = [
  'x-hzy-gateway',
  'x-hzy-gateway-token',
  'x-hzy-tenant',
  'x-hzy-deployment',
  'x-hzy-environment',
  'x-hzy-data-runtime-url',
  'x-hzy-data-runtime-token',
  'x-hzy-data-runtime-audience',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-proto'
] as const

// Codocs 以共享应用 origin 调 WebDev 时会绕过 Tenant Gateway；这里透传网关注入的
// 租户 / Data Runtime 上下文，供 WebDev 验 service token issuer 并写入当前租户数据。
function tenantContextHeaders(event: H3Event): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of TENANT_CONTEXT_HEADER_NAMES) {
    const value = String(getHeader(event, name) || '').trim()
    if (value) headers[name] = value
  }
  const host = firstHeaderValue(event, 'x-hzy-forwarded-host') || firstHeaderValue(event, 'x-forwarded-host')
  const proto = firstHeaderValue(event, 'x-hzy-forwarded-proto') || firstHeaderValue(event, 'x-forwarded-proto')
  if (host) headers['x-hzy-forwarded-host'] = host
  if (proto) headers['x-hzy-forwarded-proto'] = proto
  return headers
}

function headerValue(event: H3Event, name: string) {
  return String(getHeader(event, name) || '').trim()
}

function firstHeaderValue(event: H3Event, name: string) {
  return headerValue(event, name).split(',')[0]?.trim() || ''
}

function responseStatus(error: unknown) {
  const err = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
    data?: { statusCode?: number, status?: number }
  }
  return Number(err?.statusCode || err?.status || err?.response?.status || err?.data?.statusCode || err?.data?.status || 0) || 0
}

function responseMessage(error: unknown) {
  const err = error as {
    message?: string
    statusMessage?: string
    data?: { message?: string, statusMessage?: string, error?: string }
  }
  return String(err?.data?.message || err?.data?.statusMessage || err?.data?.error || err?.statusMessage || err?.message || '').trim()
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function serviceDiagnostics(event: H3Event, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    tenant: headerValue(event, 'x-hzy-tenant') || undefined,
    deployment: headerValue(event, 'x-hzy-deployment') || undefined,
    forwardedHost: headerValue(event, 'x-forwarded-host') || undefined,
    forwardedProto: headerValue(event, 'x-forwarded-proto') || undefined,
    hasGateway: headerValue(event, 'x-hzy-gateway') === 'tenant-gateway',
    hasGatewayToken: Boolean(headerValue(event, 'x-hzy-gateway-token')),
    hasDataRuntimeUrl: Boolean(headerValue(event, 'x-hzy-data-runtime-url')),
    hasDataRuntimeToken: Boolean(headerValue(event, 'x-hzy-data-runtime-token'))
  }
}

function consoleTokenFailureMessage(statusCode: number, message: string, scope: string) {
  if (statusCode === 403 || /insufficient_scope/i.test(message)) {
    return `反馈服务未授权：Codocs service client 缺少 ${scope} grant`
  }
  if (statusCode === 401 || /invalid_client/i.test(message)) {
    return '反馈服务认证失败：Console 拒绝 Codocs runtime 身份，请检查 Tenant Gateway runtime identity 或 service client 凭证'
  }
  if (statusCode === 503) {
    return '反馈服务未配置：Codocs service client 或 Console token URL 缺失'
  }
  return '反馈服务 token 获取失败，请检查 Console service-client 配置'
}

function webdevAuthFailureMessage(statusCode: number, message: string) {
  if (statusCode === 403 || /scope|来源应用|allowed|insufficient/i.test(message)) {
    return `反馈服务未授权：${message || 'WebDev 拒绝来源应用或 service token scope'}`
  }
  return 'WebDev 拒绝 Codocs service token，请检查 WebDev Console issuer/JWKS 与租户网关上下文透传'
}

function webdevBaseUrl(event: H3Event) {
  const base = resolveServiceAppBaseUrl(event, WEBDEV_APP_CODE)
  if (!base) {
    throw createError({ statusCode: 503, message: '无法解析 WebDev 服务端地址' })
  }
  return base.replace(/\/+$/, '')
}

async function issueServiceToken(event: H3Event, scope: string) {
  try {
    return await requestServiceAccessToken({ audience: WEBDEV_APP_CODE, scope, event })
  } catch (error) {
    const statusCode = responseStatus(error) || 502
    const message = responseMessage(error)
    console.warn('[webdev-report] Console service token request failed for WebDev issue proxy:', serviceDiagnostics(event, {
      statusCode,
      message: message || undefined,
      audience: WEBDEV_APP_CODE,
      scope
    }))
    throw createError({ statusCode: 502, message: consoleTokenFailureMessage(statusCode, message, scope) })
  }
}

async function callWebDevIssueApi<T>(event: H3Event, path: string, scope: string, options: Parameters<typeof $fetch<T>>[1]) {
  const baseUrl = webdevBaseUrl(event)
  const token = await issueServiceToken(event, scope)
  try {
    return await $fetch<T>(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...tenantContextHeaders(event),
        authorization: `Bearer ${token}`,
        ...options?.headers
      }
    })
  } catch (error) {
    const statusCode = responseStatus(error) || 502
    const message = responseMessage(error)
    console.warn('[webdev-report] WebDev issue proxy request failed:', serviceDiagnostics(event, {
      statusCode,
      message: message || undefined,
      webdevHost: safeUrlHost(baseUrl),
      scope
    }))
    if (statusCode === 401 || statusCode === 403) {
      throw createError({ statusCode: 502, message: webdevAuthFailureMessage(statusCode, message) })
    }
    throw error
  }
}

export async function reportWebDevIssue(event: H3Event, payload: Record<string, unknown>) {
  return await callWebDevIssueApi(event, '/api/webdev/issues/intake', ISSUE_WRITE_SCOPE, {
    method: 'POST',
    body: payload
  })
}

export async function listMyWebDevIssues(event: H3Event, query: Record<string, string | number | undefined>) {
  return await callWebDevIssueApi(event, '/api/webdev/issues/mine', ISSUE_READ_SCOPE, {
    method: 'GET',
    query
  })
}
