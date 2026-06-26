import type { H3Event } from 'h3'
import { createError, getCookie, getHeader } from 'h3'
import { computed, ref, shallowRef, toValue, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue'
import type {
  AuthorizationSnapshot,
  PermissionCheckInput,
  PermissionCheckResult,
  PlatformClaims,
  PlatformSdk
} from '@hzy/platform-sdk'

export type PlatformRequestContext = {
  token: string | null
  claims: PlatformClaims | null
  authorization: AuthorizationSnapshot | null
  authenticated: boolean
}

export type PlatformCapabilityValue = string | boolean | number
export type PlatformCapabilityMap = Record<string, PlatformCapabilityValue>
export type ClientRouteLike = { path: string, fullPath?: string }
export type PlatformNavigationItem<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  appCode?: string
  resourceCode?: string
  action?: string
  capability?: string
  children?: PlatformNavigationItem<T>[]
}
export type CapabilityResolver<T = AuthorizationSnapshot | null | undefined> = (snapshot: T) => PlatformCapabilityMap
export type AuthorizationLoader<T = AuthorizationSnapshot> = () => Promise<T | null>
export type AuthorizationState<T = AuthorizationSnapshot> = {
  snapshot: ShallowRef<T | null>
  loaded: Ref<boolean>
  loading: Ref<boolean>
  error: Ref<unknown | null>
  load: () => Promise<T | null>
  clear: () => void
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function firstAudience(claims: PlatformClaims | null | undefined) {
  if (!claims) return ''
  return Array.isArray(claims.aud) ? stringValue(claims.aud[0]) : stringValue(claims.aud)
}
export type ClientAuthStateOptions = {
  token?: MaybeRefOrGetter<string | null | undefined>
  claims?: MaybeRefOrGetter<PlatformClaims | null | undefined>
  logout?: () => Promise<unknown> | unknown
}
export type ClientAuthState = {
  token: Ref<string | null>
  claims: Ref<PlatformClaims | null>
  authenticated: Ref<boolean>
  logout: () => Promise<unknown> | unknown
}
export type PermissionFacadeOptions = {
  authorization: MaybeRefOrGetter<AuthorizationSnapshot | null | undefined>
  appCode?: MaybeRefOrGetter<string | null | undefined>
}
export type CapabilityStateOptions = {
  authorization: MaybeRefOrGetter<AuthorizationSnapshot | null | undefined>
  resolver?: CapabilityResolver
}
export type RoutePermissionRule = {
  pattern: string
  appCode?: string
  resourceCode: string
  action?: string
}
export type RouteCapabilityRule = {
  pattern: string
  capability: string
  expected?: PlatformCapabilityValue
}

export type TokenResolver = (input: { event: H3Event }) => string | null | Promise<string | null>

export type PlatformAdapterNuxtOptions = {
  sdk: PlatformSdk
  tokenResolver?: TokenResolver
  tokenCookieName?: string
}

type PlatformEventContext = H3Event['context'] & {
  platformRequestContext?: Promise<PlatformRequestContext>
}

function defaultTokenResolver(cookieName: string): TokenResolver {
  return ({ event }) => {
    const authorization = getHeader(event, 'authorization')
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice(7)
    }

    return getCookie(event, cookieName) || null
  }
}

function defaultCapabilityResolver(snapshot: AuthorizationSnapshot | null | undefined): PlatformCapabilityMap {
  if (!snapshot) return {}

  const capabilities: PlatformCapabilityMap = {}

  for (const role of snapshot.roles) {
    capabilities[`role:${role.roleCode}`] = true
  }

  for (const permission of snapshot.permissions) {
    capabilities[`permission:${permission.appCode}:${permission.resourceCode}:${permission.action}`] = true
  }

  return capabilities
}

export function createAuthorizationState<T = AuthorizationSnapshot>(loader: AuthorizationLoader<T>): AuthorizationState<T> {
  const snapshot = shallowRef<T | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<unknown | null>(null)
  let loadGeneration = 0
  let pendingLoad: Promise<T | null> | null = null

  async function load() {
    if (pendingLoad) {
      return await pendingLoad
    }

    const generation = loadGeneration
    loading.value = true
    error.value = null
    pendingLoad = (async () => {
      try {
        const nextSnapshot = await loader()
        if (generation === loadGeneration) {
          snapshot.value = nextSnapshot
          loaded.value = true
        }
        return nextSnapshot
      } catch (err) {
        if (generation === loadGeneration) {
          error.value = err
          loaded.value = true
          snapshot.value = null
        }
        return null
      } finally {
        if (generation === loadGeneration) {
          loading.value = false
          pendingLoad = null
        }
      }
    })()

    return await pendingLoad
  }

  function clear() {
    loadGeneration += 1
    pendingLoad = null
    snapshot.value = null
    loaded.value = false
    loading.value = false
    error.value = null
  }

  return {
    snapshot,
    loaded,
    loading,
    error,
    load,
    clear
  }
}

export function createClientAuthState(options: ClientAuthStateOptions = {}): ClientAuthState {
  const token = computed(() => String(toValue(options.token) || '').trim() || null)
  const claims = computed(() => toValue(options.claims) || null)
  const authenticated = computed(() => Boolean(token.value && claims.value))
  const logout = options.logout || (() => undefined)

  return {
    token,
    claims,
    authenticated,
    logout
  }
}

export function hasSnapshotPermission(
  snapshot: AuthorizationSnapshot | null | undefined,
  input: Omit<PermissionCheckInput, 'tenantCode' | 'uid'>
) {
  if (!snapshot) return false

  const requestedAppCode = input.appCode
  const requestedResourceCode = input.resourceCode
  const requestedAction = input.action

  const actions = snapshot.permissions
    .filter(permission => permission.appCode === requestedAppCode && permission.resourceCode === requestedResourceCode)
    .map(permission => permission.action)

  if (requestedAction === 'view') {
    return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
  }
  if (requestedAction === 'edit') {
    return actions.includes('edit') || actions.includes('admin')
  }

  return actions.includes(requestedAction)
}

export function hasSnapshotRole(snapshot: AuthorizationSnapshot | null | undefined, roleCode: string) {
  if (!snapshot) return false
  return snapshot.roles.some(role => role.roleCode === roleCode)
}

export function createPermissionFacade(options: PermissionFacadeOptions) {
  const authorization = computed(() => toValue(options.authorization) || null)
  const resolvedAppCode = computed(() => String(toValue(options.appCode) || '').trim() || '')

  function hasPermission(resourceCode: string, action: string = 'view', appCode?: string) {
    const targetAppCode = appCode || resolvedAppCode.value
    if (!targetAppCode) return false
    return hasSnapshotPermission(authorization.value, {
      appCode: targetAppCode,
      resourceCode,
      action
    })
  }

  function hasRole(roleCode: string) {
    return hasSnapshotRole(authorization.value, roleCode)
  }

  return {
    hasPermission,
    hasRole
  }
}

export function createCapabilityState<T = AuthorizationSnapshot | null | undefined>(options: {
  authorization: MaybeRefOrGetter<T>
  resolver?: CapabilityResolver<T>
}) {
  const authorization = computed(() => (toValue(options.authorization) ?? null) as T)
  const resolver = options.resolver || (defaultCapabilityResolver as CapabilityResolver<T>)
  const capabilities = computed(() => resolver(authorization.value))

  function hasCapability(key: string, expected: PlatformCapabilityValue = true) {
    return capabilities.value[key] === expected
  }

  return {
    capabilities,
    hasCapability
  }
}

export function filterNavigationItems<T extends Record<string, unknown>>(
  items: PlatformNavigationItem<T>[],
  options: {
    hasPermission?: (resourceCode: string, action?: string, appCode?: string) => boolean
    hasCapability?: (capability: string, expected?: PlatformCapabilityValue) => boolean
  }
) {
  return items
    .map((item) => {
      const nextItem: PlatformNavigationItem<T> = {
        ...item,
        children: item.children ? filterNavigationItems(item.children, options) : undefined
      }

      if (nextItem.resourceCode && options.hasPermission) {
        const allowed = options.hasPermission(nextItem.resourceCode, nextItem.action || 'view', nextItem.appCode)
        if (!allowed) return null
      }

      if (nextItem.capability && options.hasCapability) {
        const allowed = options.hasCapability(nextItem.capability, true)
        if (!allowed) return null
      }

      if (nextItem.children && nextItem.children.length === 0 && item.children) {
        return null
      }

      return nextItem
    })
    .filter(Boolean) as PlatformNavigationItem<T>[]
}

export function matchRoutePattern(path: string, pattern: string) {
  const regexStr = pattern
    .replace(/\*\*/g, '___DOUBLE___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE___/g, '.*')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(path)
}

export function createAuthGuard(options: {
  isAuthenticated: () => boolean
  isPublicRoute?: (route: ClientRouteLike) => boolean
  onUnauthenticated: (route: ClientRouteLike) => unknown
}) {
  return (route: ClientRouteLike) => {
    if (options.isPublicRoute?.(route)) {
      return
    }

    if (!options.isAuthenticated()) {
      return options.onUnauthenticated(route)
    }
  }
}

export function createPermissionGuard(options: {
  resolveRule: (route: ClientRouteLike) => RoutePermissionRule | null
  hasPermission: (resourceCode: string, action?: string, appCode?: string) => boolean
  onUnauthorized: (route: ClientRouteLike, rule: RoutePermissionRule) => unknown
}) {
  return (route: ClientRouteLike) => {
    const rule = options.resolveRule(route)
    if (!rule) {
      return
    }

    const allowed = options.hasPermission(rule.resourceCode, rule.action || 'view', rule.appCode)
    if (!allowed) {
      return options.onUnauthorized(route, rule)
    }
  }
}

export function createCapabilityGuard(options: {
  resolveRule: (route: ClientRouteLike) => RouteCapabilityRule | null
  hasCapability: (key: string, expected?: PlatformCapabilityValue) => boolean
  onUnauthorized: (route: ClientRouteLike, rule: RouteCapabilityRule) => unknown
}) {
  return (route: ClientRouteLike) => {
    const rule = options.resolveRule(route)
    if (!rule) {
      return
    }

    const allowed = options.hasCapability(rule.capability, rule.expected ?? true)
    if (!allowed) {
      return options.onUnauthorized(route, rule)
    }
  }
}

export function definePlatformNuxtAdapter(options: PlatformAdapterNuxtOptions) {
  const tokenResolver = options.tokenResolver || defaultTokenResolver(options.tokenCookieName || 'hzy_platform_token')

  async function buildRequestContext(event: H3Event): Promise<PlatformRequestContext> {
    const token = await tokenResolver({ event })
    if (!token) {
      return {
        token: null,
        claims: null,
        authorization: null,
        authenticated: false
      }
    }

    const claims = await options.sdk.verifyToken(token)
    const tenantCode = claims.tenantCode
    const uid = claims.uid
    const appCode = firstAudience(claims)
    const authorization = tenantCode && uid
      ? await options.sdk.getAuthorizationSnapshot({
          tenantCode,
          uid,
          appCode: appCode || undefined
        })
      : null

    return {
      token,
      claims,
      authorization,
      authenticated: true
    }
  }

  async function getPlatformRequestContext(event: H3Event) {
    const typedContext = event.context as PlatformEventContext
    typedContext.platformRequestContext ||= buildRequestContext(event)
    return typedContext.platformRequestContext
  }

  async function requireAuthenticated(event: H3Event) {
    const context = await getPlatformRequestContext(event)
    if (!context.authenticated || !context.claims) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        message: 'platform authentication required'
      })
    }

    return context
  }

  async function getClaims(event: H3Event) {
    const context = await getPlatformRequestContext(event)
    return context.claims
  }

  async function getAuthorizationSnapshot(event: H3Event) {
    const context = await getPlatformRequestContext(event)
    return context.authorization
  }

  async function checkPlatformPermission(event: H3Event, input: Omit<PermissionCheckInput, 'tenantCode' | 'uid'>): Promise<PermissionCheckResult> {
    const context = await requireAuthenticated(event)
    const tenantCode = context.claims?.tenantCode
    const uid = context.claims?.uid

    if (!tenantCode || !uid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'tenantCode or uid missing in platform claims'
      })
    }

    return options.sdk.checkPermission({
      tenantCode,
      uid,
      ...input
    })
  }

  async function requirePlatformPermission(event: H3Event, input: Omit<PermissionCheckInput, 'tenantCode' | 'uid'>) {
    const result = await checkPlatformPermission(event, input)
    if (!result.allowed) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: `platform permission denied: ${input.appCode}:${input.resourceCode}:${input.action}`
      })
    }

    return result
  }

  return {
    options,
    getPlatformRequestContext,
    requireAuthenticated,
    getClaims,
    getAuthorizationSnapshot,
    checkPlatformPermission,
    requirePlatformPermission
  }
}

export type PlatformNuxtAdapter = ReturnType<typeof definePlatformNuxtAdapter>
