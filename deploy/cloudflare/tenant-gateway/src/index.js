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
const PLATFORM_REGISTRY_CACHE_TTL_MS = 30_000
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

    for (const route of APP_ROUTES) {
      if (requestUrl.pathname.startsWith(route.prefix)) {
        return proxyToApp(request, env, tenant, route)
      }
    }

    return proxyToConsole(request, env, tenant)
  }
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

async function resolveTenant(hostname, env) {
  const host = normalizeHostname(hostname)
  const staticTenant = resolveStaticRegistryTenant(host, env)
  if (staticTenant) {
    return staticTenant
  }

  const platformTenant = await resolvePlatformRegistryTenant(host, env)
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

async function resolvePlatformRegistryTenant(host, env) {
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

  const response = await fetch(url.toString(), { headers })
  let value
  if (response.status === 404) {
    value = { slug: '', tenantCode: '', allowed: false, apps: {}, dataRuntime: {} }
  } else if (!response.ok) {
    throw new Error(`Platform tenant registry failed: ${response.status}`)
  } else {
    const payload = await response.json()
    value = normalizeTenantRecord(payload.data || payload, env, true)
  }

  platformRegistryCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + PLATFORM_REGISTRY_CACHE_TTL_MS
  })

  return value
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

  if (!isApi) {
    headers.delete('cookie')
    headers.delete('authorization')
  }

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual',
    cf: cachePolicyFor(requestUrl.pathname, route.prefix)
  })

  return rewriteResponse(response, request, env)
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
  const noStore = isConsoleDevAsset(requestUrl.pathname)

  if (noStore) {
    headers.set('cache-control', 'no-cache')
  }

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: requestBody(request),
    redirect: 'manual',
    cf: noStore ? consoleDevAssetCachePolicy(targetUrl, request) : undefined
  })

  return rewriteResponse(response, request, env, { noStore })
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
  const dataRuntime = shouldInjectDataRuntime(appCode) ? dataRuntimeFor(tenant, appConfig) : {}
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

function injectConsoleLoginHeaders(headers, login) {
  const config = normalizeLogin(login)
  headers.set('x-hzy-console-login-mode', config.mode)

  if (config.mode === 'oidc') {
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

  if (config.mode === 'cas') {
    setHeaderIfValue(headers, 'x-hzy-cas-base-url', config.cas.baseUrl)
  }

  if (config.mode === 'wecom') {
    setHeaderIfValue(headers, 'x-hzy-wecom-corpid', config.wecom.corpid)
    setHeaderIfValue(headers, 'x-hzy-wecom-agentid', config.wecom.agentid)
    setHeaderIfValue(headers, 'x-hzy-wecom-corpsecret', config.wecom.corpsecret)
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
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-hzy-console-login-mode',
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
    'x-hzy-wecom-corpsecret'
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
  const mode = stringValue(record.mode).toLowerCase()

  return {
    mode: ['oidc', 'cas', 'wecom'].includes(mode) ? mode : 'none',
    oidc: {
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
      agentid: firstString(wecom, ['agentid', 'agentId', 'agent_id']),
      corpsecret: firstString(wecom, ['corpsecret', 'corpSecret', 'corp_secret'])
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
  if (pathname.startsWith(`${prefix}_nuxt/`)) {
    return {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 24 * 30
    }
  }

  if (pathname === prefix) {
    return {
      cacheEverything: true,
      cacheTtl: 60
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

function consoleDevAssetCachePolicy(targetUrl, request) {
  const accept = request.headers.get('accept') || ''
  const destination = request.headers.get('sec-fetch-dest') || ''

  return {
    cacheEverything: false,
    cacheTtl: 0,
    cacheKey: `${targetUrl.toString()}|accept=${accept}|dest=${destination}`
  }
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
