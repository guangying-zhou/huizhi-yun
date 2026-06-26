import { createError, getHeader, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'

interface ConsoleApiResponse<T> {
  code: number
  data: T
  message?: string
}

interface DirectoryUser {
  uid?: string | null
  username?: string | null
  displayName?: string | null
  realName?: string | null
  nickname?: string | null
  email?: string | null
  deptCode?: string | null
  deptName?: string | null
  positionTitle?: string | null
  userType?: string | null
  status?: number | string | null
  [key: string]: unknown
}

interface DirectoryUsersResponse {
  items?: DirectoryUser[]
  total?: number
}

interface PermissionSnapshot {
  uid?: string | null
  resources?: Record<string, string[]>
}

interface ImportRequestBody {
  activeRoleCode?: string | null
  createAssignments?: boolean
  dryRun?: boolean
  limit?: number | string | null
  status?: string | null
}

interface DirectoryUsersSyncResult {
  synced?: number
  assignments_synced?: number
  [key: string]: unknown
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

function hasPermission(snapshot: PermissionSnapshot, resource: string, action: 'admin' | 'edit') {
  const actions = snapshot.resources?.[resource] || []
  if (action === 'edit') {
    return actions.includes('edit') || actions.includes('admin')
  }
  return actions.includes('admin')
}

async function assertImportPermission(event: H3Event, activeRoleCode: string) {
  const snapshot = await fetchConsoleApi<PermissionSnapshot>(event, '/api/auth/permissions', {
    appCode,
    activeRoleCode
  })

  if (!snapshot.uid) {
    throw createError({
      statusCode: 401,
      message: 'People directory sync requires login'
    })
  }
  if (
    !hasPermission(snapshot, 'admin', 'admin')
    && !hasPermission(snapshot, 'employees', 'admin')
  ) {
    throw createError({
      statusCode: 403,
      message: 'People directory sync requires employees/admin permission'
    })
  }

  return snapshot
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value || 500)
  if (!Number.isFinite(parsed) || parsed <= 0) return 500
  return Math.min(Math.floor(parsed), 1000)
}

function mapDirectoryUser(user: DirectoryUser) {
  return {
    employee_uid: stringValue(user.uid),
    employee_no: stringValue(user.uid),
    display_name: stringValue(user.displayName || user.realName || user.nickname || user.username || user.uid),
    login_name: stringValue(user.username),
    dept_code: stringValue(user.deptCode),
    dept_name: stringValue(user.deptName),
    position_name: stringValue(user.positionTitle),
    employment_status: user.status,
    employment_type: stringValue(user.userType),
    source_biz_id: stringValue(user.uid),
    source_refs: {
      console_uid: stringValue(user.uid),
      email: stringValue(user.email),
      raw: user
    }
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ImportRequestBody>(event).catch(() => ({} as ImportRequestBody))
  const activeRoleCode = stringValue(body.activeRoleCode)
  await assertImportPermission(event, activeRoleCode)

  const status = stringValue(body.status) || 'active'
  const limit = normalizeLimit(body.limit)
  const directory = await fetchConsoleApi<DirectoryUsersResponse>(event, '/api/v1/console/directory/users', {
    status
  })
  const sourceItems = (directory.items || [])
    .filter(item => stringValue(item.uid))
    .slice(0, limit)
  const items = sourceItems.map(mapDirectoryUser)

  if (body.dryRun) {
    return {
      code: 0,
      message: 'ok',
      data: {
        dry_run: true,
        status,
        total: directory.total || sourceItems.length,
        selected: items.length,
        preview: items.slice(0, 20)
      }
    }
  }

  const runtime = await maybeCallTenantRuntime<ConsoleApiResponse<DirectoryUsersSyncResult>>(event, '/v1/people/service/directory-users:sync', {
    appCode,
    scope: 'people.write',
    method: 'POST',
    body: {
      source_app: 'console',
      source_biz_type: 'directory_user',
      create_assignments: body.createAssignments !== false,
      items
    }
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'People tenant-runtime is not configured'
    })
  }

  return runtime.data
})
