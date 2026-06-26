import { createError, getHeader, getQuery, type H3Event } from 'h3'
import { appCode } from '~~/app/config/permissions'

interface PermissionsResponse {
  code: number
  data: {
    uid: string
    roles: string[]
    availableRoles?: Array<{
      roleCode: string
      roleName?: string | null
      roleType?: string | null
      appCode?: string | null
      sources?: string[]
    }>
    activeRoleCode?: string | null
    resources: Record<string, unknown>
  }
  message?: string
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

function authorizationUrl(event: H3Event) {
  const baseUrl = configuredConsoleOrigin(event)
  const url = new URL('/api/auth/permissions', baseUrl.replace(/\/+$/, ''))
  const query = getQuery(event)

  url.searchParams.set('appCode', appCode)
  for (const key of ['activeRoleCode', 'roleCode']) {
    const value = Array.isArray(query[key]) ? query[key]?.[0] : query[key]
    const normalized = stringValue(value)
    if (normalized) url.searchParams.set(key, normalized)
  }

  return url
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

export default defineEventHandler(async (event): Promise<PermissionsResponse> => {
  const target = authorizationUrl(event)

  const response = await $fetch.raw<PermissionsResponse>(target.toString(), {
    headers: forwardHeaders(event),
    timeout: 10000
  }).catch((error) => {
    throw createError({
      statusCode: Number(error?.response?.status || error?.statusCode || error?.status || 502),
      message: error?.data?.message || error?.message || 'Console authorization request failed'
    })
  })

  const data = response._data
  if (!data || typeof data !== 'object' || typeof data.code !== 'number' || !data.data) {
    throw createError({
      statusCode: 502,
      message: 'Console authorization response is invalid'
    })
  }

  return data
})
