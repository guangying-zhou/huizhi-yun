import { getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import {
  isTenantRuntimeEnabled,
  isTenantRuntimeEndpointConfigured,
  maybeCallTenantRuntime,
  type TenantRuntimeMethod,
  type TenantRuntimeResolutionOptions
} from './tenantRuntimeClient'

export interface TenantRuntimeProxyContext {
  event: H3Event
  appCode: string
  method: TenantRuntimeMethod
  suffix: string
  runtimePath: string
  currentUser: string
  currentDeptCodes: string[]
}

export interface TenantRuntimeProxyOptions {
  appCode: string
  apiPrefix?: string
  allowGlobalEndpoint?: boolean
  includeCurrentUser?: boolean
  shouldForward?: (context: TenantRuntimeProxyContext) => boolean
  resolveScope?: (context: TenantRuntimeProxyContext) => string
  resolveQuery?: (context: TenantRuntimeProxyContext, query: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
}

type TenantRuntimeActorAuth = {
  authenticated?: boolean
  uid?: string | null
  subjectType?: string | null
  deptCode?: string | null
  deptCodes?: string[] | string | null
  claims?: Record<string, unknown> | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeMethod(value: unknown): TenantRuntimeMethod {
  const method = String(value || 'GET').toUpperCase()
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') return method
  return 'GET'
}

function verifiedUserConsoleAuth(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as TenantRuntimeActorAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

function currentSubjectUid(event: H3Event) {
  return stringValue(verifiedUserConsoleAuth(event)?.uid)
}

function splitCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => splitCodes(item))
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function uniqueCodes(values: string[]) {
  return Array.from(new Set(values))
}

function currentSubjectDeptCodes(event: H3Event) {
  const consoleAuth = verifiedUserConsoleAuth(event)
  const values: string[] = []
  if (consoleAuth) {
    values.push(...splitCodes(consoleAuth.deptCodes))
    values.push(...splitCodes(consoleAuth.deptCode))
    values.push(...splitCodes(consoleAuth.claims?.dept_codes))
    values.push(...splitCodes(consoleAuth.claims?.dept_code))
  }
  return uniqueCodes(values)
}

function withCurrentUser<T extends Record<string, unknown>>(value: T, currentUser: string, currentDeptCodes: string[]) {
  const result: Record<string, unknown> = { ...value }
  delete result.current_user
  delete result.currentUser
  delete result.operator_uid
  delete result.operatorUid
  delete result.current_user_scopes
  delete result.currentUserScopes
  delete result.current_user_dept_code
  delete result.currentUserDeptCode
  delete result.current_user_dept_codes
  delete result.currentUserDeptCodes
  delete result.current_user_department_code
  delete result.currentUserDepartmentCode
  delete result.current_user_department_codes
  delete result.currentUserDepartmentCodes
  if (currentUser) {
    result.current_user = currentUser
    result.operator_uid = currentUser
  }
  if (currentDeptCodes.length > 0) {
    result.current_user_dept_code = currentDeptCodes[0]
    result.current_user_dept_codes = currentDeptCodes.join(',')
  }
  return result as T
}

function objectBody(body: unknown) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }
  return {}
}

function defaultScopeFor(appCode: string, method: TenantRuntimeMethod) {
  return method === 'GET' ? `${appCode}.read` : `${appCode}.write`
}

function apiPrefixIndex(pathname: string, apiPrefix: string) {
  const index = pathname.indexOf(apiPrefix)
  if (index < 0) return -1

  const after = pathname[index + apiPrefix.length] || ''
  if (after && after !== '/') return -1
  return index
}

export async function maybeProxyCurrentApiToTenantRuntime<T = unknown>(
  event: H3Event,
  options: TenantRuntimeProxyOptions
): Promise<T | undefined> {
  const apiPrefix = options.apiPrefix || '/api/v1'
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const resolutionOptions: TenantRuntimeResolutionOptions = {
    includeGlobal: options.allowGlobalEndpoint !== false
  }

  if (!isTenantRuntimeEndpointConfigured(event, options.appCode, config, resolutionOptions)) return undefined
  if (!isTenantRuntimeEnabled(event, options.appCode, config, resolutionOptions)) return undefined

  const url = getRequestURL(event)
  const prefixIndex = apiPrefixIndex(url.pathname, apiPrefix)
  if (prefixIndex < 0) return undefined

  const suffix = url.pathname.slice(prefixIndex + apiPrefix.length) || '/'
  const method = normalizeMethod(event.node.req.method)
  const runtimePath = `/v1/${options.appCode}${suffix === '/' ? '' : suffix}`
  const currentUser = currentSubjectUid(event)
  const currentDeptCodes = currentSubjectDeptCodes(event)
  const context: TenantRuntimeProxyContext = {
    event,
    appCode: options.appCode,
    method,
    suffix,
    runtimePath,
    currentUser,
    currentDeptCodes
  }

  if (options.shouldForward && !options.shouldForward(context)) return undefined

  const includeCurrentUser = options.includeCurrentUser !== false
  const rawQuery = getQuery(event) as Record<string, unknown>
  const baseQuery = includeCurrentUser ? withCurrentUser(rawQuery, currentUser, currentDeptCodes) : rawQuery
  const query = options.resolveQuery ? await options.resolveQuery(context, baseQuery) : baseQuery
  const rawBody = method === 'GET' ? undefined : await readBody(event)
  const body = method === 'GET'
    ? undefined
    : includeCurrentUser
      ? withCurrentUser(objectBody(rawBody), currentUser, currentDeptCodes)
      : rawBody
  const scope = options.resolveScope?.(context) || defaultScopeFor(options.appCode, method)

  const runtime = await maybeCallTenantRuntime<T>(event, runtimePath, {
    appCode: options.appCode,
    scope,
    method,
    query,
    body
  })

  return runtime.handled ? runtime.data : undefined
}
