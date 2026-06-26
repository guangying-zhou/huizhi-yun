import { createError, getHeader, type H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'

interface ConsoleApiResponse<T> {
  code: number
  data: T
  message?: string
}

interface PermissionSnapshot {
  uid?: string | null
  resources?: Record<string, string[]>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function configuredConsoleOrigin(event: H3Event) {
  const config = useRuntimeConfig(event) as {
    hzy?: {
      consoleRuntime?: {
        consoleApiUrl?: string
      }
    }
    public?: {
      consoleUrl?: string
      accountUrl?: string
    }
  }

  return stringValue(config.hzy?.consoleRuntime?.consoleApiUrl)
    || stringValue(config.public?.consoleUrl)
    || stringValue(config.public?.accountUrl)
    || 'https://console.huizhi.yun'
}

function forwardHeaders(event: H3Event) {
  const headers: Record<string, string> = {}

  for (const name of [
    'cookie',
    'authorization',
    'accept-language'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }

  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-environment',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }

  if (headers['x-hzy-gateway']) {
    headers['x-hzy-app-code'] = 'console'
  }

  return headers
}

function consoleUrl(event: H3Event, path: string, query: Record<string, unknown> = {}) {
  const baseUrl = configuredConsoleOrigin(event).replace(/\/+$/, '')
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(query)) {
    const text = stringValue(value)
    if (text) url.searchParams.set(key, text)
  }
  return url
}

async function fetchConsoleApi<T>(event: H3Event, path: string, query: Record<string, unknown> = {}) {
  const target = consoleUrl(event, path, query)
  const response = await $fetch.raw<ConsoleApiResponse<T>>(target.toString(), {
    headers: forwardHeaders(event),
    timeout: 10000
  }).catch((error) => {
    throw createError({
      statusCode: Number(error?.response?.status || error?.statusCode || error?.status || 502),
      message: error?.data?.message || error?.message || 'Console request failed'
    })
  })

  const payload = response._data
  if (!payload || typeof payload !== 'object' || payload.code !== 0) {
    throw createError({
      statusCode: 502,
      message: payload?.message || 'Console response is invalid'
    })
  }

  return payload.data
}

type PeoplePermissionAction = 'view' | 'edit' | 'approve' | 'admin'

function hasPermission(snapshot: PermissionSnapshot, resource: string, action: PeoplePermissionAction) {
  const actions = snapshot.resources?.[resource] || []
  if (action === 'view') return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
  if (action === 'edit') return actions.includes('edit') || actions.includes('admin')
  return actions.includes(action)
}

export async function assertPeoplePermission(event: H3Event, activeRoleCode: string, resource: string, action: PeoplePermissionAction) {
  const snapshot = await fetchConsoleApi<PermissionSnapshot>(event, '/api/auth/permissions', {
    appCode,
    activeRoleCode
  })

  if (!snapshot.uid) {
    throw createError({
      statusCode: 401,
      message: 'People operation requires login'
    })
  }
  if (!hasPermission(snapshot, 'admin', 'admin') && !hasPermission(snapshot, resource, action)) {
    throw createError({
      statusCode: 403,
      message: `People operation requires ${resource}/${action} permission`
    })
  }

  return snapshot
}
