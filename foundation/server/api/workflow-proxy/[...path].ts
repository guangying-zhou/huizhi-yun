/**
 * Workflow API 代理路由
 * 将 /api/workflow-proxy/** 转发到 Workflow 服务的 /api/v1/**
 * 用本应用的受信 appCode 绑定 Workflow proxy source context。
 */
import { createError, getRequestHeaders, type H3Event } from 'h3'
import { readRequestBodyCompat } from '../../utils/requestBody'
import { workflowProxyErrorData } from '../../utils/workflowProxyError'
import { resolveWorkflowApiUrl } from '../../utils/workflowRuntime'
import {
  requestServiceAccessToken,
  trustedServiceRequestHeaders
} from '../../utils/serviceOidc'
import { resolveConsoleAuthWithSessionBridge } from '../../utils/consoleSessionBridge'

function emptyOptionalWorkflowRead(path: string) {
  if (path === 'instances/by-biz') {
    return {
      code: 0,
      data: null
    }
  }
  if (path === 'instances/by-biz-history') {
    return {
      code: 0,
      data: []
    }
  }
  return null
}

function upstreamStatusCode(error: unknown) {
  const err = error as {
    status?: number
    statusCode?: number
    response?: {
      status?: number
      statusCode?: number
    }
  }
  return Number(err?.status || err?.statusCode || err?.response?.status || err?.response?.statusCode || 0) || 0
}

function canFallbackOptionalWorkflowRead(error: unknown) {
  const statusCode = upstreamStatusCode(error)
  if (statusCode === 401 || statusCode === 403) return false
  return statusCode === 0 || statusCode === 404 || statusCode === 502 || statusCode === 503 || statusCode === 504 || statusCode === 522
}

function throwWorkflowProxyError(error: unknown): never {
  const upstream = workflowProxyErrorData(error)
  throw createError({
    statusCode: upstream.statusCode,
    statusMessage: upstream.statusMessage,
    message: upstream.message,
    data: {
      code: upstream.code,
      message: upstream.message,
      upstreamStatus: upstream.upstreamStatus
    }
  })
}

function upstreamHeaders(event: Parameters<typeof getRequestHeaders>[0]) {
  const headers = new Headers()
  const incomingHeaders = getRequestHeaders(event)
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!value) continue
    if (key === 'host' || key === 'connection' || key === 'content-length') continue
    headers.set(key, value)
  }
  return headers
}

const externalFetch = $fetch as unknown as <T>(request: string, options?: {
  method?: string
  headers?: Headers
  body?: unknown
}) => Promise<T>

async function currentUserUid(event: H3Event) {
  let auth = event.context.consoleAuth as {
    authenticated?: boolean
    subjectType?: string | null
    uid?: string | null
  } | undefined

  if (!auth?.authenticated) {
    // 业务应用通过 session bridge（HTTP 调 Console auth/me）兜底；Console 自身不能
    // bridge（CF Worker 无法自调），其 session 认证由 console 本地中间件直接补全到
    // event.context.consoleAuth，因此这里走到时已是认证态或确实未登录。
    auth = await resolveConsoleAuthWithSessionBridge(event)
    event.context.consoleAuth = auth
  }

  if (!auth?.authenticated || auth.subjectType === 'service') return ''
  return String(auth.uid || '').trim()
}

async function workflowProxyHeaders(event: H3Event, appCode: string) {
  const uid = await currentUserUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const headers = upstreamHeaders(event)
  headers.delete('authorization')
  headers.delete('cookie')
  headers.delete('content-length')
  // Direct service-origin calls do not pass through Tenant Gateway a second
  // time, so rewrite the complete trusted runtime context (app, deployment and
  // base path) to the actual target. The caller identity remains the signed
  // source token plus x-hzy-request-app-code.
  for (const [name, value] of Object.entries(trustedServiceRequestHeaders(event, 'workflow'))) {
    headers.set(name, value)
  }
  headers.set('authorization', `Bearer ${await requestServiceAccessToken({
    audience: 'workflow',
    scope: 'workflow:proxy',
    event
  })}`)
  headers.set('x-hzy-actor-uid', uid)
  if (appCode) headers.set('x-hzy-request-app-code', appCode)
  return headers
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const runtimeConfig = config as {
    public?: { appCode?: string, appName?: string }
  }
  const workflowBaseUrl = await resolveWorkflowApiUrl(event)
  const path = getRouterParam(event, 'path') || ''

  const pub = runtimeConfig.public
  const appCode = String(pub?.appCode || '').trim()
  if (!appCode) {
    throw createError({ statusCode: 503, message: 'Workflow proxy app identity is not configured.' })
  }

  // 浏览器传入的 request_app_code 不能作为来源事实；用服务端配置覆盖。
  const originalQuery = getQuery(event)
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(originalQuery)) {
    if (value !== undefined && value !== null) {
      queryParams.set(key, String(value))
    }
  }
  queryParams.set('request_app_code', appCode)

  const targetUrl = `${workflowBaseUrl}/api/v1/${path}?${queryParams.toString()}`
  const method = String(event.node.req.method || 'GET').toUpperCase()

  const optionalFallback = method === 'GET'
    ? emptyOptionalWorkflowRead(path)
    : null
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readRequestBodyCompat(event).catch(() => undefined)

  if (method === 'GET' && optionalFallback) {
    const headers = await workflowProxyHeaders(event, appCode)
    try {
      return await externalFetch(targetUrl, {
        method,
        headers
      })
    } catch (error: unknown) {
      if (canFallbackOptionalWorkflowRead(error)) return optionalFallback
      throwWorkflowProxyError(error)
    }
  }

  try {
    return await externalFetch(targetUrl, {
      method,
      headers: await workflowProxyHeaders(event, appCode),
      body
    })
  } catch (error: unknown) {
    if (optionalFallback && canFallbackOptionalWorkflowRead(error)) return optionalFallback
    throwWorkflowProxyError(error)
  }
})
