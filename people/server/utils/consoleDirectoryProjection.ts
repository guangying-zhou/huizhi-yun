import { createError, getHeader, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface ConsoleEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

export interface DisableConsoleUserResult {
  uid?: string
  status?: string | null
  disabled?: boolean
  alreadyDisabled?: boolean
  revoked?: {
    sessions?: number
    refreshTokens?: number
  }
  idempotencyKey?: string
}

export interface DisableConsoleUserInput {
  employeeUid: string
  operatorUid?: string | null
  leaveDate?: string | null
  reason?: string | null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  const base = trimTrailingSlash(baseUrl)
  const normalizedPath = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalizedPath.startsWith('api/v1/')) {
    return `${base}/${normalizedPath.slice('api/v1/'.length)}`
  }
  if (base.endsWith('/api') && normalizedPath.startsWith('api/')) {
    return `${base}/${normalizedPath.slice('api/'.length)}`
  }
  return `${base}/${normalizedPath}`
}

function forwardedContextHeaders(event: H3Event) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  return headers
}

export async function disableConsoleDirectoryUser(event: H3Event, input: DisableConsoleUserInput) {
  const employeeUid = text(input.employeeUid)
  if (!employeeUid) {
    throw createError({ statusCode: 400, message: 'employeeUid is required.' })
  }

  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/' })
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })
  }

  const idempotencyKey = `people:employee:${employeeUid}:disable-console-directory-user:v1`
  const token = await requestServiceAccessToken({
    audience: 'console_directory',
    scope: 'console_directory:write',
    event
  })

  const response = await $fetch<ConsoleEnvelope<DisableConsoleUserResult>>(
    appendPath(baseUrl, `/api/v1/console/service/directory/users/${encodeURIComponent(employeeUid)}/disable`),
    {
      method: 'POST',
      headers: {
        ...forwardedContextHeaders(event),
        'authorization': `Bearer ${token}`,
        'idempotency-key': idempotencyKey
      },
      body: {
        sourceApp: 'people',
        reason: text(input.reason) || 'people_offboarding',
        operatorUid: text(input.operatorUid),
        leaveDate: text(input.leaveDate)
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Console directory disable API returned an error.' })
  }
  if (!response.data) {
    throw createError({ statusCode: 502, message: 'Console directory disable API returned empty data.' })
  }
  return response.data
}
