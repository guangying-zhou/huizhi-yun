const DEFAULT_CONSOLE_ORIGIN = 'https://console.huizhi.yun'
const DEFAULT_FINANCE_ORIGIN = 'https://finance.isme.dev'
const DEFAULT_ALTOC_ORIGIN = 'https://altoc.isme.dev'
const DEFAULT_AIMS_ORIGIN = 'https://hzy-aims.zhouguangying.workers.dev'
const DEFAULT_ASSETS_ORIGIN = 'https://hzy-assets.zhouguangying.workers.dev'
const DEFAULT_CODOCS_ORIGIN = 'https://codocs.isme.dev'
const DEFAULT_PEOPLE_ORIGIN = 'https://people.huizhi.yun'
const DEFAULT_WORKFLOW_ORIGIN = 'https://hzy-workflow.zhouguangying.workers.dev'
const DEFAULT_COLLAB_ORIGIN = 'https://hzy-collab-codocs-poc.zhouguangying.workers.dev'
const DEFAULT_OBSERVABILITY_ORIGIN = 'https://hzy-observability.zhouguangying.workers.dev'
const DEFAULT_WEBDEV_ORIGIN = 'https://webdev.huizhi.yun'
const DIRECTORY_CONNECTOR_PREFIX = '/directory-connector'
const PLATFORM_REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000
const PLATFORM_REGISTRY_STALE_TTL_MS = 24 * 60 * 60 * 1000
const PLATFORM_REGISTRY_CACHE_MARKER = '__hzy_tenant_gateway_registry_cache_v2'
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000
const SCHEDULER_APPS = new Set(['aims', 'altoc', 'console', 'finance', 'people', 'workflow'])
const APP_SERVICE_BINDINGS = Object.freeze({
  aims: 'HZY_AIMS_SERVICE',
  assets: 'HZY_ASSETS_SERVICE',
  altoc: 'HZY_ALTOC_SERVICE',
  console: 'HZY_CONSOLE_SERVICE',
  finance: 'HZY_FINANCE_SERVICE',
  people: 'HZY_PEOPLE_SERVICE',
  workflow: 'HZY_WORKFLOW_SERVICE',
  platform: 'HZY_PLATFORM_SERVICE'
})
const SCHEDULER_WAKE_PATH = '/api/internal/integration-operations/drain'
const SCHEDULER_MAX_APP_PASSES = 3
const DEFAULT_OIDC_DISPLAY_NAME = '企业统一身份登录'
const MAX_OIDC_DISPLAY_NAME_LENGTH = 10
const DEFAULT_RESERVED_TENANT_SUBDOMAINS = [
  'admin',
  'aims',
  'align',
  'altoc',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'billing',
  'cdn',
  'cdn-cgi',
  'codocs',
  'collab',
  'console',
  'dashboard',
  'dev',
  'docs',
  'downloads',
  'finance',
  'help',
  'hrm',
  'id',
  'insights',
  'login',
  'mail',
  'oauth',
  'observability',
  'people',
  'platform',
  'root',
  'rum',
  'sso',
  'static',
  'status',
  'staging',
  'support',
  'test',
  'webdev',
  'workflow',
  'www'
]
const DEFAULT_RESERVED_TENANT_SUBDOMAIN_PREFIXES = [
  'dev-agent-'
]
const DEFAULT_RESERVED_TENANT_SUBDOMAIN_SUFFIXES = [
  '-data-runtime'
]

const platformRegistryCache = new Map()
const runtimeBootstrapTokenCache = new Map()

const APP_ROUTES = [
  {
    appCode: 'finance',
    prefix: '/finance/',
    barePath: '/finance',
    originEnv: 'HZY_FINANCE_ORIGIN',
    defaultOrigin: DEFAULT_FINANCE_ORIGIN
  },
  {
    appCode: 'altoc',
    prefix: '/altoc/',
    barePath: '/altoc',
    originEnv: 'HZY_ALTOC_ORIGIN',
    defaultOrigin: DEFAULT_ALTOC_ORIGIN
  },
  {
    appCode: 'aims',
    prefix: '/aims/',
    barePath: '/aims',
    originEnv: 'HZY_AIMS_ORIGIN',
    defaultOrigin: DEFAULT_AIMS_ORIGIN
  },
  {
    appCode: 'assets',
    prefix: '/assets/',
    barePath: '/assets',
    originEnv: 'HZY_ASSETS_ORIGIN',
    defaultOrigin: DEFAULT_ASSETS_ORIGIN
  },
  {
    appCode: 'codocs',
    prefix: '/codocs/',
    barePath: '/codocs',
    originEnv: 'HZY_CODOCS_ORIGIN',
    defaultOrigin: DEFAULT_CODOCS_ORIGIN
  },
  {
    appCode: 'people',
    prefix: '/people/',
    barePath: '/people',
    originEnv: 'HZY_PEOPLE_ORIGIN',
    defaultOrigin: DEFAULT_PEOPLE_ORIGIN
  },
  {
    appCode: 'workflow',
    prefix: '/workflow/',
    barePath: '/workflow',
    originEnv: 'HZY_WORKFLOW_ORIGIN',
    defaultOrigin: DEFAULT_WORKFLOW_ORIGIN
  },
  {
    appCode: 'webdev',
    prefix: '/webdev/',
    barePath: '/webdev',
    originEnv: 'HZY_WEBDEV_ORIGIN',
    defaultOrigin: DEFAULT_WEBDEV_ORIGIN
  }
]

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)
    if (isForbiddenSchedulerHttpPath(requestUrl.pathname)) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain;charset=utf-8' }
      })
    }
    const reservedHost = reservedTenantHost(requestUrl.hostname, env)
    if (reservedHost) {
      return passthroughReservedHost(request, env)
    }

    let tenant
    try {
      tenant = await resolveTenant(requestUrl.hostname, env)
    } catch (error) {
      console.error('Tenant registry resolution failed', error)
      return new Response('Tenant registry unavailable', {
        status: 502,
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          'x-hzy-gateway': 'tenant-gateway'
        }
      })
    }

    if (!tenant.allowed) {
      return new Response('Unknown tenant', {
        status: 404,
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          'x-hzy-gateway': 'tenant-gateway'
        }
      })
    }

    const canonicalRedirect = canonicalRedirectUrl(requestUrl)
    if (canonicalRedirect) {
      return Response.redirect(canonicalRedirect, 308)
    }

    if (isObservabilityRequest(requestUrl.pathname)) {
      return proxyToObservability(request, env, tenant)
    }

    if (isCollabRequest(requestUrl.pathname)) {
      return proxyToCollab(request, env, tenant)
    }

    if (isDirectoryConnectorRequest(requestUrl.pathname)) {
      return proxyToDirectoryConnector(request, env, tenant)
    }

    for (const route of APP_ROUTES) {
      if (requestUrl.pathname.startsWith(route.prefix)) {
        return proxyToApp(request, env, tenant, route)
      }
    }

    return proxyToConsole(request, env, tenant)
  },
  async scheduled(controller, env, context) {
    const promise = controller.cron === '* * * * *'
      ? runScheduledPolicyBundleSync(env)
      : runScheduledIntegrationDrains(controller, env)
    context?.waitUntil?.(promise)
    return await promise
  }
}

function isSchedulerWakePath(pathname) {
  return pathname === '/api/internal/policy-bundle/sync'
    || pathname === '/console/api/internal/policy-bundle/sync'
    || pathname === SCHEDULER_WAKE_PATH
    || /^\/(?:aims|altoc|finance|people|workflow)\/api\/internal\/integration-operations\/drain$/.test(pathname)
}

function isForbiddenSchedulerHttpPath(pathname) {
  return isSchedulerWakePath(pathname) || /(?:^|\/)\_nitro\/tasks(?:\/|$)/.test(pathname)
}

async function passthroughReservedHost(request, env) {
  const headers = new Headers(request.headers)
  if (!isTrustedInternalForward(request, env)) {
    stripInternalHeaders(headers)
  }
  return await fetch(new Request(request, { headers }))
}

function isTrustedInternalForward(request, env) {
  const expected = tenantGatewayInternalToken(env)
  return Boolean(
    expected
    && stringValue(request.headers.get('x-hzy-gateway')) === 'tenant-gateway'
    && stringValue(request.headers.get('x-hzy-gateway-token')) === expected
  )
}

function reservedTenantHost(hostname, env) {
  const host = normalizeHostname(hostname)
  const suffix = tenantDomainSuffix(env)
  if (!host || !suffix) return ''

  const suffixWithDot = `.${suffix}`
  if (!host.endsWith(suffixWithDot)) return ''

  const subdomain = host.slice(0, -suffixWithDot.length)
  if (!subdomain || subdomain.includes('.')) return ''

  if (reservedTenantSubdomainSet(env).has(subdomain)) {
    return subdomain
  }

  if (reservedTenantSubdomainPrefixes(env).some(prefix => subdomain.startsWith(prefix))) {
    return subdomain
  }

  return reservedTenantSubdomainSuffixes(env).some(suffix => subdomain.endsWith(suffix)) ? subdomain : ''
}

function tenantDomainSuffix(env) {
  return stringValue(env.HZY_TENANT_DOMAIN_SUFFIX || 'huizhi.yun')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase()
}

function reservedTenantSubdomainSet(env) {
  const appCodes = APP_ROUTES.map(route => route.appCode)
  return new Set([
    ...DEFAULT_RESERVED_TENANT_SUBDOMAINS,
    ...appCodes,
    ...stringValue(env.HZY_TENANT_GATEWAY_RESERVED_SUBDOMAINS)
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ])
}

function reservedTenantSubdomainPrefixes(env) {
  return [
    ...DEFAULT_RESERVED_TENANT_SUBDOMAIN_PREFIXES,
    ...stringValue(env.HZY_TENANT_GATEWAY_RESERVED_SUBDOMAIN_PREFIXES)
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ]
}

function reservedTenantSubdomainSuffixes(env) {
  return [
    ...DEFAULT_RESERVED_TENANT_SUBDOMAIN_SUFFIXES,
    ...stringValue(env.HZY_TENANT_GATEWAY_RESERVED_SUBDOMAIN_SUFFIXES)
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  ]
}

function canonicalRedirectUrl(requestUrl) {
  let shouldRedirect = false
  const target = new URL(requestUrl)

  if (target.protocol === 'http:') {
    target.protocol = 'https:'
    shouldRedirect = true
  }

  const route = APP_ROUTES.find(item => target.pathname === item.barePath)
  if (route) {
    target.pathname = route.prefix
    shouldRedirect = true
  }

  return shouldRedirect ? target.toString() : null
}

async function resolveTenant(hostname, env, fetchImpl = fetch) {
  const host = normalizeHostname(hostname)
  const staticTenant = resolveStaticRegistryTenant(host, env)
  if (staticTenant) {
    return staticTenant
  }

  const platformTenant = await resolvePlatformRegistryTenant(host, env, fetchImpl)
  if (platformTenant) {
    return platformTenant
  }

  const suffix = stringValue(env.HZY_TENANT_DOMAIN_SUFFIX || 'huizhi.yun').replace(/^\.+|\.+$/g, '')
  const defaultTenant = stringValue(env.HZY_DEFAULT_TENANT || 'wiztek')
  const allowedTenants = new Set(
    stringValue(env.HZY_ALLOWED_TENANTS || defaultTenant)
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  )

  const suffixWithDot = `.${suffix.toLowerCase()}`
  const slug = host.endsWith(suffixWithDot)
    ? host.slice(0, -suffixWithDot.length)
    : defaultTenant

  const tenantSlug = slug || defaultTenant
  return {
    slug: tenantSlug,
    tenantCode: tenantSlug,
    deploymentCode: stringValue(env.HZY_DEFAULT_DEPLOYMENT || ''),
    apps: {},
    dataRuntime: {},
    allowed: !allowedTenants.size || allowedTenants.has(tenantSlug.toLowerCase())
  }
}

function resolveStaticRegistryTenant(host, env) {
  const registry = parseTenantRegistry(env.HZY_TENANT_GATEWAY_REGISTRY_JSON || env.HZY_TENANT_REGISTRY_JSON)
  if (!registry) return null

  const domainEntry = recordValue(registry.domains)?.[host]
  const tenantCodeFromDomain = typeof domainEntry === 'string'
    ? domainEntry
    : firstString(domainEntry, ['tenantCode', 'tenant', 'slug'])
  const suffixTenant = tenantSlugFromHost(host, env)
  const tenantCode = stringValue(tenantCodeFromDomain || suffixTenant || env.HZY_DEFAULT_TENANT)
  const tenantEntry = tenantCode ? recordValue(registry.tenants)?.[tenantCode] : null
  const entry = mergeTenantRecords(tenantEntry, typeof domainEntry === 'object' ? domainEntry : null)

  if (!entry && !domainEntry) {
    return { slug: tenantCode, tenantCode, allowed: false, apps: {}, dataRuntime: {} }
  }

  return normalizeTenantRecord({
    ...entry,
    tenantCode,
    host
  }, env, true)
}

async function resolvePlatformRegistryTenant(
  host,
  env,
  fetchImpl = fetch,
  edgeCache = globalThis.caches?.default
) {
  const registryUrl = stringValue(env.HZY_TENANT_GATEWAY_REGISTRY_URL)
  if (!registryUrl) return null

  const cacheKey = `${registryUrl}|${host}`
  const cached = platformRegistryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const url = new URL(registryUrl)
  url.searchParams.set('host', host)

  const headers = new Headers({ accept: 'application/json' })
  const token = platformRegistryToken(env)
  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }

  const rawEdgeCached = await readPlatformRegistryEdgeCache(edgeCache, url)
  const edgeCached = rawEdgeCached
    ? { ...rawEdgeCached, value: normalizeTenantRecord(rawEdgeCached.value, env, true) }
    : null
  if (edgeCached && edgeCached.expiresAt > Date.now()) {
    platformRegistryCache.set(cacheKey, edgeCached)
    return edgeCached.value
  }

  let response
  try {
    response = await fetchImpl(url.toString(), { headers })
  } catch (error) {
    const stale = stalePlatformRegistryValue(cached, edgeCached)
    if (stale) return stale
    throw error
  }

  let value
  if (response.status === 404) {
    value = { slug: '', tenantCode: '', allowed: false, apps: {}, dataRuntime: {} }
  } else if (!response.ok) {
    const stale = stalePlatformRegistryValue(cached, edgeCached)
    if (stale) return stale
    throw new Error(`Platform tenant registry failed: ${response.status}`)
  } else {
    const payload = await response.json()
    value = normalizeTenantRecord(payload.data || payload, env, true)
  }

  const entry = {
    value,
    expiresAt: Date.now() + PLATFORM_REGISTRY_CACHE_TTL_MS,
    staleUntil: Date.now() + PLATFORM_REGISTRY_STALE_TTL_MS
  }
  platformRegistryCache.set(cacheKey, entry)

  if (response.ok && response.status !== 404) {
    await writePlatformRegistryEdgeCache(edgeCache, url, entry)
  }

  return value
}

function stalePlatformRegistryValue(...entries) {
  const now = Date.now()
  const entry = entries.find(item => item && item.staleUntil > now)
  return entry?.value || null
}

function platformRegistryEdgeCacheKey(url) {
  const key = new URL(url)
  key.searchParams.set(PLATFORM_REGISTRY_CACHE_MARKER, '1')
  return new Request(key.toString(), { method: 'GET' })
}

async function readPlatformRegistryEdgeCache(edgeCache, url) {
  if (!edgeCache?.match) return null

  try {
    const response = await edgeCache.match(platformRegistryEdgeCacheKey(url))
    if (!response?.ok) return null

    const cachedAt = Number(response.headers.get('x-hzy-registry-cached-at'))
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null

    const value = await response.json()
    return {
      value,
      expiresAt: cachedAt + PLATFORM_REGISTRY_CACHE_TTL_MS,
      staleUntil: cachedAt + PLATFORM_REGISTRY_STALE_TTL_MS
    }
  } catch {
    return null
  }
}

async function writePlatformRegistryEdgeCache(edgeCache, url, entry) {
  if (!edgeCache?.put) return

  try {
    await edgeCache.put(platformRegistryEdgeCacheKey(url), new Response(JSON.stringify(entry.value), {
      headers: {
        'cache-control': `public, max-age=${Math.floor(PLATFORM_REGISTRY_STALE_TTL_MS / 1000)}`,
        'content-type': 'application/json; charset=utf-8',
        'x-hzy-registry-cached-at': String(Date.now())
      }
    }))
  } catch {
    // Registry availability must not depend on the optional Cloudflare Cache API.
  }
}

function normalizeTenantRecord(record, env, registryBacked = false) {
  const allowedTenants = allowedTenantSet(env)
  const tenantCode = stringValue(firstString(record, ['tenantCode', 'tenant', 'slug']) || env.HZY_DEFAULT_TENANT || '')
  const deploymentCode = stringValue(firstString(record, ['deploymentCode', 'deployment']) || env.HZY_DEFAULT_DEPLOYMENT || '')
  const environment = stringValue(firstString(record, ['environment', 'deploymentEnvironment']) || env.HZY_DEPLOYMENT_ENVIRONMENT || 'prod')
  const apps = recordValue(record?.apps) || {}
  const dataRuntime = normalizeDataRuntime(record?.dataRuntime || record?.data_runtime || {})
  const login = normalizeLogin(record?.login || record?.consoleLogin || record?.auth || {})
  const hasExplicitAllowlist = Boolean(stringValue(env.HZY_ALLOWED_TENANTS))
  const allowed = registryBacked
    ? Boolean(tenantCode) && (!hasExplicitAllowlist || allowedTenants.has(tenantCode.toLowerCase()))
    : Boolean(tenantCode) && (!allowedTenants.size || allowedTenants.has(tenantCode.toLowerCase()))

  return {
    slug: tenantCode,
    tenantCode,
    deploymentCode,
    environment,
    apps,
    dataRuntime,
    login,
    allowed
  }
}

function mergeTenantRecords(base, override) {
  if (!base && !override) return null
  return {
    ...(recordValue(base) || {}),
    ...(recordValue(override) || {}),
    apps: {
      ...(recordValue(base)?.apps || {}),
      ...(recordValue(override)?.apps || {})
    },
    dataRuntime: {
      ...(recordValue(base)?.dataRuntime || recordValue(base)?.data_runtime || {}),
      ...(recordValue(override)?.dataRuntime || recordValue(override)?.data_runtime || {})
    },
    login: {
      ...(recordValue(base)?.login || recordValue(base)?.consoleLogin || recordValue(base)?.auth || {}),
      ...(recordValue(override)?.login || recordValue(override)?.consoleLogin || recordValue(override)?.auth || {})
    }
  }
}

function parseTenantRegistry(value) {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function tenantSlugFromHost(host, env) {
  const suffix = stringValue(env.HZY_TENANT_DOMAIN_SUFFIX || 'huizhi.yun').replace(/^\.+|\.+$/g, '')
  if (!suffix) return ''
  const suffixWithDot = `.${suffix.toLowerCase()}`
  return host.endsWith(suffixWithDot) ? host.slice(0, -suffixWithDot.length) : ''
}

function allowedTenantSet(env) {
  const defaultTenant = stringValue(env.HZY_DEFAULT_TENANT || 'wiztek')
  return new Set(
    stringValue(env.HZY_ALLOWED_TENANTS || defaultTenant)
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  )
}

async function proxyToApp(request, env, tenant, route) {
  const origin = normalizeOrigin(env[route.originEnv] || route.defaultOrigin)
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, origin)
  const headers = buildForwardHeaders(request, env, tenant, route.prefix, route.appCode)
  const isApi = requestUrl.pathname.startsWith(`${route.prefix}api/`)
  const isBuildAsset = isAppBuildAssetPath(requestUrl.pathname, route.prefix)
  const noStore = shouldNoStoreAppResponse(request, route.prefix)

  if (isApi) {
    const runtimeBootstrapToken = await resolveRuntimeBootstrapToken(env, tenant)
    if (runtimeBootstrapToken) {
      headers.set('x-hzy-data-runtime-token', runtimeBootstrapToken)
    }
  }

  if (!isApi) {
    headers.delete('cookie')
    headers.delete('authorization')
  }

  const response = await serviceBindingFetch(env, APP_SERVICE_BINDINGS[route.appCode], fetch, targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual',
    cf: cachePolicyFor(requestUrl.pathname, route.prefix)
  })

  if (isBuildAsset && isHtmlResponse(response)) {
    return rewriteResponse(new Response('Build asset not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    }), request, env, { noStore: true })
  }

  return rewriteResponse(response, request, env, { noStore, immutable: isBuildAsset })
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback
  return parsed
}

function schedulerRegistryUrl(env) {
  const configured = stringValue(env.HZY_TENANT_GATEWAY_SCHEDULER_REGISTRY_URL)
  if (configured) return configured
  const resolveUrl = stringValue(env.HZY_TENANT_GATEWAY_REGISTRY_URL)
  if (!resolveUrl) return ''
  try {
    const url = new URL(resolveUrl)
    url.pathname = url.pathname.replace(/\/resolve\/?$/, '/scheduler-page')
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function schedulerOptions(controller, env) {
  const shardCount = boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_SHARD_COUNT, 12, 1, 256)
  const slot = Math.floor(boundedInteger(controller?.scheduledTime, Date.now(), 0, Number.MAX_SAFE_INTEGER) / SCHEDULER_INTERVAL_MS)
  return {
    slot,
    shardCount,
    shardIndex: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_SHARD_INDEX, slot % shardCount, 0, shardCount - 1),
    pageSize: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_PAGE_SIZE, 25, 1, 100),
    maxPages: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_MAX_PAGES, 4, 1, 20),
    maxTenants: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_MAX_TENANTS, 50, 1, 500),
    concurrency: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_CONCURRENCY, 4, 1, 16),
    maxAppPasses: SCHEDULER_MAX_APP_PASSES,
    maxWallTimeMs: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_MAX_WALL_TIME_MS, 45_000, 100, 50_000),
    requestTimeoutMs: boundedInteger(env.HZY_TENANT_GATEWAY_SCHEDULER_REQUEST_TIMEOUT_MS, 30_000, 100, 35_000)
  }
}

function schedulerPageItems(value) {
  const payload = recordValue(value)?.data || value
  const items = Array.isArray(recordValue(payload)?.items) ? payload.items : []
  return {
    items: items.map((item) => {
      const record = recordValue(item) || {}
      return {
        host: normalizeHostname(record.host),
        tenantCode: stringValue(record.tenantCode),
        environment: stringValue(record.environment),
        appCodes: Array.isArray(record.appCodes)
          ? [...new Set(record.appCodes.map(stringValue).filter(appCode => SCHEDULER_APPS.has(appCode)))]
          : []
      }
    }).filter(item => item.host && item.tenantCode && item.appCodes.length > 0),
    nextCursor: stringValue(recordValue(payload)?.nextCursor) || null
  }
}

async function loadSchedulerPage(env, options, cursor, fetchImpl) {
  const registryUrl = schedulerRegistryUrl(env)
  if (!registryUrl) throw new Error('Tenant scheduler registry URL is not configured.')
  const url = new URL(registryUrl)
  url.searchParams.set('slot', String(options.slot))
  url.searchParams.set('shardIndex', String(options.shardIndex))
  url.searchParams.set('shardCount', String(options.shardCount))
  url.searchParams.set('limit', String(options.pageSize))
  url.searchParams.set('windowSize', String(options.maxTenants))
  if (cursor) url.searchParams.set('cursor', cursor)
  const headers = new Headers({ accept: 'application/json' })
  const token = platformRegistryToken(env)
  if (!token) throw new Error('Tenant scheduler registry token is not configured.')
  headers.set('authorization', `Bearer ${token}`)
  const response = await serviceBindingFetch(env, APP_SERVICE_BINDINGS.platform, fetchImpl, url.toString(), { headers })
  if (!response.ok) {
    const responseSummary = stringValue(await response.text()).slice(0, 300)
    throw new Error(`Tenant scheduler registry failed: ${response.status}${responseSummary ? ` ${responseSummary}` : ''}`)
  }
  return schedulerPageItems(await response.json())
}

async function serviceBindingFetch(env, bindingName, fetchImpl, input, init) {
  const service = env?.[bindingName]
  if (service && typeof service.fetch === 'function') {
    return await service.fetch(input, init)
  }
  return await fetchImpl(input, init)
}

async function schedulerHmacHex(secret, value) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function schedulerBootstrapMetadata(token) {
  try {
    const parts = stringValue(token).split('.')
    if (parts.length !== 3) return { format: 'opaque' }
    const decode = part => {
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    }
    const header = decode(parts[0])
    const payload = decode(parts[1])
    return {
      format: 'jwt',
      kid: stringValue(header.kid),
      alg: stringValue(header.alg),
      issuer: stringValue(payload.iss),
      audience: payload.aud,
      subject: stringValue(payload.sub),
      tokenUse: stringValue(payload.token_use),
      tenant: stringValue(payload.tenant),
      deployment: stringValue(payload.deployment),
      appCode: stringValue(payload.appCode || payload.app_code),
      runtimeCode: stringValue(payload.runtimeCode),
      scope: payload.scope,
      issuedAt: Number(payload.iat || 0),
      expiresAt: Number(payload.exp || 0),
      hasJti: Boolean(stringValue(payload.jti))
    }
  } catch {
    return { format: 'unparseable' }
  }
}

async function schedulerRequestHeaders(env, tenant, tenantHost, appCode, requestId, issuedAt, runtimeBootstrapToken, path = SCHEDULER_WAKE_PATH) {
  const appConfig = recordValue(tenant.apps?.[appCode]) || {}
  const consoleConfig = recordValue(tenant.apps?.console) || {}
  const dataRuntime = dataRuntimeFor(tenant, appConfig)
  const deploymentCode = firstString(appConfig, ['deploymentCode', 'deployment']) || tenant.deploymentCode
  const consoleTargetDeployment = firstString(consoleConfig, ['deploymentCode', 'deployment'])
  const headers = new Headers({
    'content-type': 'application/json',
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-scheduler': 'tenant-gateway',
    'x-hzy-tenant': tenant.tenantCode,
    'x-hzy-app-code': appCode,
    'x-hzy-environment': stringValue(tenant.environment || 'prod'),
    'x-forwarded-host': tenantHost,
    'x-forwarded-proto': 'https',
    'x-request-id': requestId
  })
  // scheduler wake 必须和普通代理路径一样带上受信服务路由目录：
  // 目标应用的 Foundation 用它把 x-hzy-app-code / x-hzy-deployment /
  // x-forwarded-prefix 原子改写到目标应用（根 CLAUDE.md 的硬性约束）。
  // 缺了它，跨 Worker 调用会按设计剥掉这三个字段（宁可不发也不冒充来源上下文），
  // 目标应用便无法向 Console 自证身份换取 runtime 令牌，一律 503。
  // 走查 ISSUE-B-025 生产实测：所有 gateway-drain 重试因此 100% 失败。
  const serviceRoutes = buildTrustedServiceRouteCatalog(env, tenant)
  if (serviceRoutes) {
    headers.set('x-hzy-service-routes', serviceRoutes)
  }

  const gatewayToken = tenantGatewayInternalToken(env)
  if (!gatewayToken) throw new Error('Tenant Gateway internal token is not configured.')
  headers.set('x-hzy-gateway-token', gatewayToken)
  if (deploymentCode) headers.set('x-hzy-deployment', deploymentCode)
  if (appCode === 'people' && consoleTargetDeployment) {
    headers.set('x-hzy-console-target-deployment', consoleTargetDeployment)
  }
  if (dataRuntime.endpoint) headers.set('x-hzy-data-runtime-url', dataRuntime.endpoint)
  if (dataRuntime.runtimeCode) headers.set('x-hzy-data-runtime-code', dataRuntime.runtimeCode)
  if (dataRuntime.audience) headers.set('x-hzy-data-runtime-audience', dataRuntime.audience)
  if (runtimeBootstrapToken) headers.set('x-hzy-data-runtime-token', runtimeBootstrapToken)
  headers.set('x-hzy-scheduler-issued-at', issuedAt)
  const canonical = [
    'POST',
    path,
    requestId,
    tenant.tenantCode,
    deploymentCode,
    appCode,
    stringValue(tenant.environment || 'prod'),
    dataRuntime.endpoint,
    tenantHost
  ]
  if (appCode === 'people') canonical.push(consoleTargetDeployment)
  canonical.push(issuedAt)
  headers.set('x-hzy-scheduler-signature', await schedulerHmacHex(gatewayToken, canonical.join('\n')))
  return headers
}

// Independent of business drains and request traffic. Explicit hosts must be
// configured per environment; resolveTenant still validates each registry entry.
export async function runScheduledPolicyBundleSync(env, fetchImpl = fetch) {
  const hosts = [...new Set(stringValue(env.HZY_POLICY_SYNC_HOSTS).split(',').map(normalizeHostname).filter(Boolean))]
  if (hosts.length > 100) throw new Error('policy sync host limit exceeded')
  const results = []
  const deadline = Date.now() + 45_000
  await mapWithConcurrency(hosts, 4, async host => {
    if (Date.now() >= deadline) {
      results.push({ ok: false, status: 503, stage: 'budget' })
      return
    }
    let stage = 'registry'
    try {
      const platformFetch = (input, init) => serviceBindingFetch(env, APP_SERVICE_BINDINGS.platform, fetchImpl, input,
        { ...init, signal: AbortSignal.timeout(15_000) })
      const tenant = await resolveTenant(host, env, platformFetch)
      if (!tenant.allowed || reservedTenantHost(host, env)) throw new Error('invalid sync tenant')
      stage = 'bootstrap'
      const token = await resolveRuntimeBootstrapToken(env, tenant, platformFetch)
      const path = '/api/internal/policy-bundle/sync'
      stage = 'headers'
      const headers = await schedulerRequestHeaders(env, tenant, host, 'console', crypto.randomUUID(), String(Date.now()), token, path)
      stage = 'console'
      const response = await serviceBindingFetch(env, APP_SERVICE_BINDINGS.console, fetchImpl,
        new URL(path, normalizeOrigin(env.HZY_CONSOLE_ORIGIN || DEFAULT_CONSOLE_ORIGIN)),
        { method: 'POST', headers, signal: AbortSignal.timeout(35_000) })
      await response.arrayBuffer()
      results.push({ ok: response.ok, status: response.status, stage })
    } catch {
      results.push({ ok: false, status: 503, stage })
    }
  })
  if (results.some(result => !result.ok)) console.error('Policy bundle sync failed', results.filter(result => !result.ok))
  return results
}

async function wakeTenantApp(env, tenant, tenantHost, appCode, requestId, issuedAt, runtimeBootstrapToken, options, fetchImpl) {
  const route = appCode === 'console'
    ? { prefix: '/', originEnv: 'HZY_CONSOLE_ORIGIN', defaultOrigin: DEFAULT_CONSOLE_ORIGIN }
    : APP_ROUTES.find(item => item.appCode === appCode)
  if (!route) return { ok: false, busy: false }
  const origin = normalizeOrigin(env[route.originEnv] || route.defaultOrigin)
  const url = new URL(`${route.prefix}${SCHEDULER_WAKE_PATH.replace(/^\/+/, '')}`, origin)
  const response = await serviceBindingFetch(env, APP_SERVICE_BINDINGS[appCode], fetchImpl, url.toString(), {
    method: 'POST',
    headers: await schedulerRequestHeaders(env, tenant, tenantHost, appCode, requestId, issuedAt, runtimeBootstrapToken),
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(options.requestTimeoutMs) : undefined
  })
  if (!response.ok) {
    const responseSummary = stringValue(await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
    console.error('Tenant scheduler wake failed', {
      tenantCode: tenant.tenantCode,
      appCode,
      status: response.status,
      responseSummary,
      runtimeBootstrap: schedulerBootstrapMetadata(runtimeBootstrapToken)
    })
    return { ok: false, busy: false }
  }
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // Successful legacy drains without JSON do not opt in to same-wake continuation.
  }
  const envelope = recordValue(payload)
  const data = recordValue(envelope?.data) || envelope
  const result = recordValue(data?.result) || data
  const preparation = recordValue(data?.preparation)
  const claimed = Number(result?.claimed || 0)
  const created = Number(preparation?.created || 0)
  return {
    ok: true,
    busy: (Number.isFinite(claimed) && claimed > 0) || (Number.isFinite(created) && created > 0)
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function createConcurrencyGate(concurrency) {
  let active = 0
  const waiters = []
  return async function run(worker) {
    if (active >= concurrency) {
      await new Promise(resolve => waiters.push(resolve))
    } else {
      active += 1
    }
    try {
      return await worker()
    } finally {
      const next = waiters.shift()
      if (next) next()
      else active -= 1
    }
  }
}

async function processSchedulerTenant(item, env, options, fetchImpl, now, startedAt, counters, runWake) {
  if (now() - startedAt >= options.maxWallTimeMs) return
  try {
    if (reservedTenantHost(item.host, env)) {
      counters.failedTenants += 1
      return
    }
    const platformFetch = (input, init) => serviceBindingFetch(
      env,
      APP_SERVICE_BINDINGS.platform,
      fetchImpl,
      input,
      init
    )
    const tenant = await resolveTenant(item.host, env, platformFetch)
    if (
      !tenant.allowed
      || tenant.tenantCode !== item.tenantCode
      || (item.environment && tenant.environment !== item.environment)
      || !normalizeDataRuntime(tenant.dataRuntime).endpoint
    ) {
      counters.failedTenants += 1
      return
    }
    const runtimeBootstrapToken = await resolveRuntimeBootstrapToken(env, tenant, platformFetch)
    if (!runtimeBootstrapToken) {
      throw new Error('Tenant Runtime bootstrap token is unavailable for scheduler wakes.')
    }
    let pendingApps = [...item.appCodes]
    for (let pass = 1; pass <= options.maxAppPasses && pendingApps.length > 0; pass += 1) {
      if (now() - startedAt >= options.maxWallTimeMs) break
      const busyApps = []
      await mapWithConcurrency(pendingApps, pendingApps.length, appCode => runWake(async () => {
        const elapsed = now() - startedAt
        if (elapsed >= options.maxWallTimeMs) return
        counters.attemptedWakes += 1
        const requestId = `gateway-drain-${options.slot}-${options.shardIndex}-${item.tenantCode}-${appCode}-p${pass}`
        const issuedAt = String(now())
        const wakeOptions = {
          ...options,
          requestTimeoutMs: Math.max(100, Math.min(options.requestTimeoutMs, options.maxWallTimeMs - elapsed))
        }
        try {
          const wake = await wakeTenantApp(env, tenant, item.host, appCode, requestId, issuedAt, runtimeBootstrapToken, wakeOptions, fetchImpl)
          if (!wake.ok) {
            counters.failedWakes += 1
            return
          }
          counters.succeededWakes += 1
          if (wake.busy) busyApps.push(appCode)
        } catch (error) {
          counters.failedWakes += 1
          console.error('Tenant scheduler wake failed', {
            tenantCode: item.tenantCode,
            appCode,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }))
      pendingApps = busyApps
    }
  } catch (error) {
    console.error('Tenant scheduler tenant failed', {
      tenantCode: item.tenantCode,
      message: error instanceof Error ? error.message : String(error)
    })
    counters.failedTenants += 1
  }
}

export async function runScheduledIntegrationDrains(controller, env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch
  const now = dependencies.now || Date.now
  const options = schedulerOptions(controller, env)
  const startedAt = now()
  const runWake = createConcurrencyGate(options.concurrency)
  const counters = {
    pages: 0,
    tenants: 0,
    attemptedWakes: 0,
    succeededWakes: 0,
    failedWakes: 0,
    failedTenants: 0,
    stoppedBy: 'empty'
  }
  let cursor = ''

  while (
    counters.pages < options.maxPages
    && counters.tenants < options.maxTenants
    && now() - startedAt < options.maxWallTimeMs
  ) {
    const page = await loadSchedulerPage(env, options, cursor, fetchImpl)
    counters.pages += 1
    const remaining = options.maxTenants - counters.tenants
    const items = page.items.slice(0, remaining)
    if (items.length === 0) {
      counters.stoppedBy = 'empty'
      break
    }
    counters.tenants += items.length
    await mapWithConcurrency(items, options.concurrency, item =>
      processSchedulerTenant(item, env, options, fetchImpl, now, startedAt, counters, runWake))
    if (now() - startedAt >= options.maxWallTimeMs) {
      counters.stoppedBy = 'max_wall_time'
      break
    }
    if (counters.tenants >= options.maxTenants) {
      counters.stoppedBy = 'max_tenants'
      break
    }
    if (!page.nextCursor) {
      counters.stoppedBy = 'empty'
      break
    }
    cursor = page.nextCursor
    counters.stoppedBy = 'max_pages'
  }
  return counters
}

async function proxyToCollab(request, env, tenant) {
  const origin = normalizeOrigin(env.HZY_COLLAB_ORIGIN || DEFAULT_COLLAB_ORIGIN)
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, origin)
  const headers = buildForwardHeaders(request, env, tenant, '/codocs', 'collab')

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual'
  })

  if (isWebSocketUpgrade(request) && response.webSocket) {
    return response
  }

  return rewriteResponse(response, request, env)
}

async function proxyToObservability(request, env, tenant) {
  const origin = normalizeOrigin(env.HZY_OBSERVABILITY_ORIGIN || DEFAULT_OBSERVABILITY_ORIGIN)
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, origin)
  const headers = buildForwardHeaders(request, env, tenant, '', 'observability')

  headers.delete('cookie')
  headers.delete('authorization')
  headers.set('x-hzy-observability-source', 'tenant-gateway')

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual'
  })

  return rewriteResponse(response, request, env, { noStore: true })
}

async function proxyToConsole(request, env, tenant) {
  const origin = normalizeOrigin(env.HZY_CONSOLE_ORIGIN || DEFAULT_CONSOLE_ORIGIN)
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, origin)
  const headers = buildForwardHeaders(request, env, tenant, '', 'console')
  preserveTrustedServiceTokenSource(request, env, tenant, headers)
  const runtimeBootstrapToken = await resolveRuntimeBootstrapToken(env, tenant)
  if (runtimeBootstrapToken) {
    headers.set('x-hzy-data-runtime-token', runtimeBootstrapToken)
  }
  // Console pages contain tenant-specific session state and a Nuxt entry
  // manifest.  Do not allow the browser or edge to reuse a prior page shell
  // after a Console deployment; hashed build assets remain cacheable by name.
  const isBuildAsset = isConsoleDevAsset(requestUrl.pathname)
  const noStore = shouldNoStoreAppResponse(request, '/')

  if (noStore) {
    headers.set('cache-control', 'no-cache')
  }

  const response = await serviceBindingFetch(env, APP_SERVICE_BINDINGS.console, fetch, targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual',
    cf: cachePolicyFor(requestUrl.pathname, '/')
  })

  if (isBuildAsset && isHtmlResponse(response)) {
    return rewriteResponse(new Response('Build asset not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    }), request, env, { noStore: true })
  }

  return rewriteResponse(response, request, env, { noStore, immutable: isBuildAsset })
}

function preserveTrustedServiceTokenSource(request, env, tenant, headers) {
  const requestUrl = new URL(request.url)
  if (
    request.method !== 'POST'
    || requestUrl.pathname !== '/oauth/token'
    || !isTrustedInternalForward(request, env)
  ) {
    return
  }

  const tenantCode = stringValue(tenant.tenantCode || tenant.slug)
  const environment = stringValue(tenant.environment || tenant.deploymentEnvironment || 'prod')
  const sourceAppCode = stringValue(request.headers.get('x-hzy-app-code'))
  const sourceApp = recordValue(tenant.apps?.[sourceAppCode])
  const expectedDeployment = firstString(sourceApp, ['deploymentCode', 'deployment'])
  if (
    !sourceApp
    || !tenantCode
    || !expectedDeployment
    || stringValue(request.headers.get('x-hzy-tenant')) !== tenantCode
    || stringValue(request.headers.get('x-hzy-environment')) !== environment
    || stringValue(request.headers.get('x-hzy-deployment')) !== expectedDeployment
  ) {
    return
  }

  headers.set('x-hzy-app-code', sourceAppCode)
  headers.set('x-hzy-deployment', expectedDeployment)
}

async function resolveRuntimeBootstrapToken(env, tenant, fetchImpl = fetch) {
  const appConfig = recordValue(tenant.apps?.console) || {}
  const runtime = dataRuntimeFor(tenant, appConfig)
  if (!runtime.endpoint || runtime.staticToken) return ''

  const registryUrl = stringValue(env.HZY_TENANT_GATEWAY_REGISTRY_URL)
  const token = platformRegistryToken(env)
  if (!registryUrl || !token) return ''

  const cacheKey = [
    tenant.tenantCode || tenant.slug,
    tenant.environment || 'prod',
    firstString(appConfig, ['deploymentCode', 'deployment']) || tenant.deploymentCode,
    runtime.runtimeCode || ''
  ].join('|')
  const cached = runtimeBootstrapTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 15_000) {
    return cached.token
  }

  const url = new URL(registryUrl)
  url.pathname = url.pathname.replace(/\/resolve\/?$/, '/runtime-bootstrap-token')
  url.search = ''
  url.hash = ''
  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      tenantCode: tenant.tenantCode || tenant.slug,
      environment: tenant.environment || 'prod',
      appCode: 'console'
    })
  })
  if (!response.ok) {
    throw new Error(`Platform runtime bootstrap token failed: ${response.status}`)
  }
  const payload = await response.json()
  const data = recordValue(payload.data) || payload
  const accessToken = stringValue(data.token)
  const expiresAt = new Date(stringValue(data.expiresAt)).getTime()
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 15_000) {
    throw new Error('Platform runtime bootstrap token response is invalid')
  }
  runtimeBootstrapTokenCache.set(cacheKey, { token: accessToken, expiresAt })
  return accessToken
}

function isDirectoryConnectorRequest(pathname) {
  const upstreamPath = pathname.slice(DIRECTORY_CONNECTOR_PREFIX.length) || '/'
  return pathname.startsWith(`${DIRECTORY_CONNECTOR_PREFIX}/`)
    && (
      upstreamPath === '/oauth/token'
      || upstreamPath === '/api/v1/console/directory-connectors/enroll'
      || upstreamPath.startsWith('/api/v1/console/service/directory-connector/')
    )
}

async function proxyToDirectoryConnector(request, env, tenant) {
  const origin = normalizeOrigin(env.HZY_CONSOLE_ORIGIN || DEFAULT_CONSOLE_ORIGIN)
  const requestUrl = new URL(request.url)
  const pathname = requestUrl.pathname.slice(DIRECTORY_CONNECTOR_PREFIX.length) || '/'
  const targetUrl = new URL(pathname + requestUrl.search, origin)
  const headers = buildForwardHeaders(request, env, tenant, DIRECTORY_CONNECTOR_PREFIX, 'directory-connector')
  const runtimeBootstrapToken = await resolveRuntimeBootstrapToken(env, tenant)
  if (runtimeBootstrapToken) {
    headers.set('x-hzy-data-runtime-token', runtimeBootstrapToken)
  }

  headers.delete('cookie')

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual'
  })

  return rewriteResponse(response, request, env, { noStore: true })
}

function isCollabRequest(pathname) {
  return pathname === '/codocs/ws' || pathname.startsWith('/collab/')
}

function isObservabilityRequest(pathname) {
  return pathname === '/api/rum' || pathname === '/rum' || pathname === '/cdn-cgi/rum'
}

function isWebSocketUpgrade(request) {
  return (request.headers.get('upgrade') || '').toLowerCase() === 'websocket'
}

function buildForwardHeaders(request, env, tenant, prefix, appCode) {
  const requestUrl = new URL(request.url)
  const headers = new Headers(request.headers)
  const tenantCode = tenant.tenantCode || tenant.slug
  const appConfig = recordValue(tenant.apps?.[appCode]) || {}
  const appDataRuntime = shouldInjectDataRuntime(appCode) ? dataRuntimeFor(tenant, appConfig) : {}
  const consoleDataRuntime = appCode !== 'console'
    && requestUrl.pathname.startsWith(`${prefix}api/auth/`)
    && !appDataRuntime.endpoint
    ? dataRuntimeFor(tenant, recordValue(tenant.apps?.console) || {})
    : {}
  // A business application's schema gate must not prevent its BFF from
  // completing Console OIDC/session operations. Only auth routes may borrow
  // the ready Console binding; business API routes remain fail-closed.
  const dataRuntime = consoleDataRuntime.endpoint
    ? { ...appDataRuntime, endpoint: consoleDataRuntime.endpoint }
    : appDataRuntime
  const deploymentCode = firstString(appConfig, ['deploymentCode', 'deployment']) || tenant.deploymentCode
  const environment = stringValue(tenant.environment || tenant.deploymentEnvironment || 'prod')

  stripInternalHeaders(headers)
  headers.set('x-forwarded-host', requestUrl.host)
  headers.set('x-forwarded-proto', requestUrl.protocol.replace(/:$/, '') || 'https')
  headers.set('x-forwarded-port', requestUrl.protocol === 'https:' ? '443' : '80')
  headers.set('x-hzy-gateway', 'tenant-gateway')
  headers.set('x-hzy-tenant', tenantCode)
  headers.set('x-hzy-app-code', appCode)
  headers.set('x-hzy-environment', environment)

  const serviceRoutes = buildTrustedServiceRouteCatalog(env, tenant)
  if (serviceRoutes) {
    headers.set('x-hzy-service-routes', serviceRoutes)
  }

  const gatewayToken = tenantGatewayInternalToken(env)
  if (gatewayToken) {
    headers.set('x-hzy-gateway-token', gatewayToken)
  }

  if (deploymentCode) {
    headers.set('x-hzy-deployment', deploymentCode)
  }

  if (dataRuntime.endpoint) {
    headers.set('x-hzy-data-runtime-url', dataRuntime.endpoint)
  }

  if (dataRuntime.runtimeCode) {
    headers.set('x-hzy-data-runtime-code', dataRuntime.runtimeCode)
  }

  if (dataRuntime.staticToken) {
    headers.set('x-hzy-data-runtime-token', dataRuntime.staticToken)
  }

  if (dataRuntime.audience) {
    headers.set('x-hzy-data-runtime-audience', dataRuntime.audience)
  }

  if (prefix) {
    headers.set('x-forwarded-prefix', prefix.replace(/\/+$/, ''))
  } else {
    headers.delete('x-forwarded-prefix')
  }

  if (appCode === 'console') {
    injectConsoleLoginHeaders(headers, tenant.login)
  }

  return headers
}

function buildTrustedServiceRouteCatalog(env, tenant) {
  const routes = {}
  for (const route of APP_ROUTES) {
    const appConfig = recordValue(tenant.apps?.[route.appCode])
    if (!appConfig) continue

    const origin = normalizeOrigin(env[route.originEnv] || route.defaultOrigin)
    const deploymentCode = firstString(appConfig, ['deploymentCode', 'deployment']) || tenant.deploymentCode
    const configuredBasePath = firstString(appConfig, ['basePath', 'base_path'])
    const candidateBasePath = stringValue(configuredBasePath || route.barePath)
    const basePath = /^\/[a-z0-9/_-]{1,128}\/?$/i.test(candidateBasePath)
      ? `/${candidateBasePath.replace(/^\/+|\/+$/g, '')}/`
      : `${route.barePath}/`
    routes[route.appCode] = {
      origin,
      deploymentCode: stringValue(deploymentCode),
      basePath
    }
  }
  return Object.keys(routes).length ? JSON.stringify(routes) : ''
}

function injectConsoleLoginHeaders(headers, login) {
  const config = normalizeLogin(login)
  headers.set('x-hzy-console-login-mode', config.mode)
  headers.set('x-hzy-console-login-providers', config.enabledProviders.join(','))

  if (config.enabledProviders.includes('oidc')) {
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-display-name', encodeURIComponent(config.oidc.displayName))
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-provider-code', config.oidc.providerCode)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-issuer', config.oidc.issuer)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-authorization-endpoint', config.oidc.authorizationEndpoint)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-token-endpoint', config.oidc.tokenEndpoint)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-userinfo-endpoint', config.oidc.userinfoEndpoint)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-end-session-endpoint', config.oidc.endSessionEndpoint)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-jwks-uri', config.oidc.jwksUri)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-client-id', config.oidc.clientId)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-client-secret', config.oidc.clientSecret)
    setHeaderIfValue(headers, 'x-hzy-sso-oidc-scope', config.oidc.scope)
  }

  if (config.enabledProviders.includes('cas')) {
    setHeaderIfValue(headers, 'x-hzy-cas-base-url', config.cas.baseUrl)
  }

  if (config.enabledProviders.includes('wecom')) {
    setHeaderIfValue(headers, 'x-hzy-wecom-corpid', config.wecom.corpid)
    setHeaderIfValue(headers, 'x-hzy-wecom-agentid', config.wecom.agentid)
  }

  if (config.enabledProviders.includes('dingtalk')) {
    setHeaderIfValue(headers, 'x-hzy-dingtalk-client-id', config.dingtalk.clientId)
    setHeaderIfValue(headers, 'x-hzy-dingtalk-corp-id', config.dingtalk.corpId)
  }
}

function setHeaderIfValue(headers, name, value) {
  const normalized = stringValue(value)
  if (normalized) headers.set(name, normalized)
}

function stripInternalHeaders(headers) {
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-app-code',
    'x-hzy-service-routes',
    'x-hzy-scheduler',
    'x-hzy-scheduler-issued-at',
    'x-hzy-scheduler-signature',
    'x-hzy-console-target-deployment',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-code',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-hzy-console-login-mode',
    'x-hzy-console-login-providers',
    'x-hzy-sso-oidc-display-name',
    'x-hzy-sso-oidc-provider-code',
    'x-hzy-sso-oidc-issuer',
    'x-hzy-sso-oidc-authorization-endpoint',
    'x-hzy-sso-oidc-token-endpoint',
    'x-hzy-sso-oidc-userinfo-endpoint',
    'x-hzy-sso-oidc-end-session-endpoint',
    'x-hzy-sso-oidc-jwks-uri',
    'x-hzy-sso-oidc-client-id',
    'x-hzy-sso-oidc-client-secret',
    'x-hzy-sso-oidc-scope',
    'x-hzy-cas-base-url',
    'x-hzy-wecom-corpid',
    'x-hzy-wecom-agentid',
    'x-hzy-wecom-corpsecret',
    'x-hzy-dingtalk-client-id',
    'x-hzy-dingtalk-corp-id'
  ]) {
    headers.delete(name)
  }
}

function dataRuntimeFor(tenant, appConfig) {
  return {
    ...normalizeDataRuntime(tenant.dataRuntime || {}),
    ...nonEmptyRecord(normalizeDataRuntime(recordValue(appConfig.dataRuntime) || recordValue(appConfig.data_runtime) || {}))
  }
}

function normalizeDataRuntime(value) {
  const record = recordValue(value) || {}
  return {
    endpoint: normalizeDataRuntimeEndpoint(firstString(record, ['endpoint', 'url'])),
    runtimeCode: firstString(record, ['runtimeCode', 'runtime_code']),
    staticToken: firstString(record, ['staticToken', 'token']),
    audience: firstString(record, ['audience'])
  }
}

function normalizeDataRuntimeEndpoint(value) {
  const raw = stringValue(value)
  if (!raw) return ''

  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''
    }
    if (isLoopbackHostname(url.hostname)) {
      return ''
    }

    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function isLoopbackHostname(value) {
  const host = stringValue(value).replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost'
    || host === '0.0.0.0'
    || host === '::1'
    || /^127(?:\.\d{1,3}){0,3}$/.test(host)
}

function nonEmptyRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => Boolean(value)))
}

function normalizeLogin(value) {
  const record = recordValue(value) || {}
  const oidc = recordValue(record.oidc) || {}
  const cas = recordValue(record.cas) || {}
  const wecom = recordValue(record.wecom) || {}
  const dingtalk = recordValue(record.dingtalk) || {}
  const mode = stringValue(record.mode).toLowerCase()
  const normalizedMode = ['oidc', 'cas', 'wecom', 'dingtalk'].includes(mode) ? mode : 'none'
  const configuredProviders = Array.isArray(record.enabledProviders)
    ? record.enabledProviders
        .map(item => stringValue(item).toLowerCase())
        .filter(item => ['oidc', 'cas', 'wecom', 'dingtalk'].includes(item))
    : []
  const enabledProviders = normalizedMode === 'none'
    ? []
    : Array.from(new Set([normalizedMode, ...(configuredProviders.length ? configuredProviders : [normalizedMode])]))
  const oidcDisplayName = firstString(oidc, ['displayName', 'display_name'])

  return {
    mode: normalizedMode,
    enabledProviders,
    oidc: {
      displayName: oidcDisplayName && Array.from(oidcDisplayName).length <= MAX_OIDC_DISPLAY_NAME_LENGTH
        ? oidcDisplayName
        : DEFAULT_OIDC_DISPLAY_NAME,
      providerCode: firstString(oidc, ['providerCode', 'provider_code']) || 'sso_oidc',
      issuer: firstString(oidc, ['issuer']),
      authorizationEndpoint: firstString(oidc, ['authorizationEndpoint', 'authorization_endpoint']),
      tokenEndpoint: firstString(oidc, ['tokenEndpoint', 'token_endpoint']),
      userinfoEndpoint: firstString(oidc, ['userinfoEndpoint', 'userinfo_endpoint']),
      endSessionEndpoint: firstString(oidc, ['endSessionEndpoint', 'end_session_endpoint']),
      jwksUri: firstString(oidc, ['jwksUri', 'jwks_uri']),
      clientId: firstString(oidc, ['clientId', 'client_id']),
      clientSecret: firstString(oidc, ['clientSecret', 'client_secret']),
      scope: firstString(oidc, ['scope']) || 'openid profile email'
    },
    cas: {
      baseUrl: firstString(cas, ['baseUrl', 'base_url'])
    },
    wecom: {
      corpid: firstString(wecom, ['corpid', 'corpId', 'corp_id']),
      agentid: firstString(wecom, ['agentid', 'agentId', 'agent_id'])
    },
    dingtalk: {
      clientId: firstString(dingtalk, ['clientId', 'client_id', 'appKey', 'app_key']),
      corpId: firstString(dingtalk, ['corpId', 'corp_id'])
    }
  }
}

function shouldInjectDataRuntime(appCode) {
  // Console 自身用 hzy_console 库、不直接读 data-runtime，但其内嵌的审批中心会通过
  // workflow-proxy 转发到 Workflow，而 Workflow 需要 x-hzy-data-runtime-url 才能访问
  // /api/v1 数据。因此为 console 也注入租户级 data-runtime 头（console 仅转发不消费）。
  return appCode !== 'collab' && appCode !== 'observability'
}

function requestBody(request) {
  return request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : request.body
}

function cachePolicyFor(pathname, prefix) {
  if (isAppBuildAssetPath(pathname, prefix)) {
    return {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 24 * 365
    }
  }

  if (/\/(favicon\.ico|favicon\.png|logo\.(png|svg)|manifest\.webmanifest)$/.test(pathname)) {
    return {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 24 * 30
    }
  }

  return undefined
}

function isAppBuildAssetPath(pathname, prefix) {
  return pathname.startsWith(`${prefix}_nuxt/`)
}

function isHtmlResponse(response) {
  return String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')
}

function shouldNoStoreAppResponse(request, prefix) {
  const requestUrl = new URL(request.url)
  const pathname = requestUrl.pathname
  if (!pathname.startsWith(prefix)) return false
  if (pathname.startsWith(`${prefix}api/`)) return false
  if (isAppBuildAssetPath(pathname, prefix)) return false

  const destination = stringValue(request.headers.get('sec-fetch-dest')).toLowerCase()
  const accept = stringValue(request.headers.get('accept')).toLowerCase()
  return destination === 'document'
    || accept.includes('text/html')
    || pathname === prefix
    || !/\.[a-z0-9]{2,8}$/i.test(pathname)
}

function rewriteResponse(response, request, env, options = {}) {
  const headers = new Headers(response.headers)
  const location = headers.get('location')

  if (location) {
    const rewritten = rewriteLocation(location, request, env)
    if (rewritten) {
      headers.set('location', rewritten)
    }
  }

  headers.set('x-hzy-gateway', 'tenant-gateway')
  headers.append('vary', 'Host')
  if (new URL(request.url).protocol === 'https:') {
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }

  if (options.noStore) {
    headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
    headers.set('pragma', 'no-cache')
    headers.append('vary', 'Accept')
    headers.append('vary', 'Sec-Fetch-Dest')
    headers.delete('expires')
  } else if (options.immutable) {
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    headers.delete('pragma')
    headers.delete('expires')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

function rewriteLocation(location, request, env) {
  try {
    const requestUrl = new URL(request.url)
    const locationUrl = new URL(location, requestUrl)
    const origins = [
      env.HZY_CONSOLE_ORIGIN || DEFAULT_CONSOLE_ORIGIN,
      env.HZY_FINANCE_ORIGIN || DEFAULT_FINANCE_ORIGIN,
      env.HZY_ALTOC_ORIGIN || DEFAULT_ALTOC_ORIGIN,
      env.HZY_AIMS_ORIGIN || DEFAULT_AIMS_ORIGIN,
      env.HZY_ASSETS_ORIGIN || DEFAULT_ASSETS_ORIGIN,
      env.HZY_CODOCS_ORIGIN || DEFAULT_CODOCS_ORIGIN,
      env.HZY_PEOPLE_ORIGIN || DEFAULT_PEOPLE_ORIGIN,
      env.HZY_WORKFLOW_ORIGIN || DEFAULT_WORKFLOW_ORIGIN,
      env.HZY_COLLAB_ORIGIN || DEFAULT_COLLAB_ORIGIN,
      env.HZY_OBSERVABILITY_ORIGIN || DEFAULT_OBSERVABILITY_ORIGIN,
      env.HZY_WEBDEV_ORIGIN || DEFAULT_WEBDEV_ORIGIN
    ].map(normalizeOrigin)

    rewriteNestedRedirect(locationUrl, requestUrl, origins)

    if (!origins.includes(locationUrl.origin)) {
      return locationUrl.origin === requestUrl.origin ? relativeLocation(locationUrl) : locationUrl.toString()
    }

    locationUrl.protocol = requestUrl.protocol
    locationUrl.host = requestUrl.host
    return locationUrl.toString()
  } catch {
    return location
  }
}

function rewriteNestedRedirect(locationUrl, requestUrl, origins) {
  const redirect = locationUrl.searchParams.get('redirect')
  if (!redirect) return

  try {
    const redirectUrl = new URL(redirect, requestUrl)
    if (!origins.includes(redirectUrl.origin)) return

    redirectUrl.protocol = requestUrl.protocol
    redirectUrl.host = requestUrl.host
    locationUrl.searchParams.set('redirect', redirectUrl.toString())
  } catch {
    // Ignore malformed user-provided redirect values and preserve upstream behavior.
  }
}

function relativeLocation(url) {
  return `${url.pathname}${url.search}${url.hash}`
}

function isConsoleDevAsset(pathname) {
  return pathname.startsWith('/_nuxt/')
}

function normalizeOrigin(value) {
  const url = new URL(stringValue(value))
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function normalizeHostname(value) {
  return stringValue(value).replace(/:\d+$/, '').toLowerCase()
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export {
  buildForwardHeaders,
  preserveTrustedServiceTokenSource,
  cachePolicyFor,
  isAppBuildAssetPath,
  isHtmlResponse,
  resolvePlatformRegistryTenant,
  rewriteResponse,
  shouldNoStoreAppResponse
}

function firstString(record, keys) {
  const source = recordValue(record)
  if (!source) return ''
  for (const key of keys) {
    const value = stringValue(source[key])
    if (value) return value
  }
  return ''
}

function cloudflareInternalToken(env) {
  return stringValue(env.HZY_CLOUDFLARE_INTERNAL_TOKEN)
}

function platformRegistryToken(env) {
  return cloudflareInternalToken(env) || stringValue(env.HZY_PLATFORM_INTERNAL_TOKEN || env.HZY_TENANT_GATEWAY_REGISTRY_TOKEN)
}

function tenantGatewayInternalToken(env) {
  return cloudflareInternalToken(env) || stringValue(env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN)
}

function stringValue(value) {
  return String(value || '').trim()
}
