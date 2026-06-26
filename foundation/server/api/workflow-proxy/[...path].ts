/**
 * Workflow API 代理路由
 * 将 /api/workflow-proxy/** 转发到 Workflow 服务的 /api/v1/**
 * 自动附加 request_app_code 参数标识请求来源应用
 */
import { createError, getRequestHeaders, readBody, type H3Event } from 'h3'
import { resolveWorkflowApiUrl } from '../../utils/workflowRuntime'
import { requestServiceAccessToken } from '../../utils/serviceOidc'
import { resolveConsoleAuthWithSessionBridge } from '../../utils/consoleSessionBridge'

const OPTIONAL_TASK_LIST_PATHS = new Set([
  'tasks/pending',
  'tasks/done',
  'tasks/initiated'
])

function emptyTaskList() {
  return {
    code: 0,
    data: {
      total: 0,
      items: []
    }
  }
}

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
  return statusCode === 0 || statusCode === 404 || statusCode === 502 || statusCode === 503 || statusCode === 504
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
  const appCode = pub?.appCode || pub?.appName || ''

  // 获取原始 query 参数并追加 request_app_code
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
    ? (OPTIONAL_TASK_LIST_PATHS.has(path) ? emptyTaskList() : emptyOptionalWorkflowRead(path))
    : null
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readBody(event).catch(() => undefined)

  if (method === 'GET' && optionalFallback) {
    const headers = await workflowProxyHeaders(event, appCode)
    try {
      return await externalFetch(targetUrl, {
        method,
        headers
      })
    } catch (error: unknown) {
      if (canFallbackOptionalWorkflowRead(error)) return optionalFallback
      throw error
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

    throw error
  }
})
