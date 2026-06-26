import { getHeader, type H3Event } from 'h3'
import { getCachedBundleInvalidReason, readCachedBundle } from '~~/server/utils/bundleCache'
import {
  isTrustedTenantGatewayRequest,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'

type CloudflareRuntimeEnv = Record<string, unknown>
type ConsoleLoginMode = 'none' | 'oidc' | 'cas' | 'wecom'

type CloudflareRuntimeEvent = H3Event & {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}

type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareRuntimeEnv
}

export interface ConsoleLoginConfig {
  mode: ConsoleLoginMode
  oidc: {
    enabled: boolean
    providerCode: string
    issuer: string
    authorizationEndpoint: string
    tokenEndpoint: string
    userinfoEndpoint: string
    endSessionEndpoint: string
    jwksUri: string
    clientId: string
    clientSecret: string
    scope: string
  }
  cas: {
    enabled: boolean
    baseUrl: string
  }
  wecom: {
    enabled: boolean
    corpid: string
    agentid: string
    corpsecret: string
  }
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeUrl(value: unknown) {
  return normalizeString(value).replace(/\/+$/, '')
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeLoginMode(value: unknown): ConsoleLoginMode {
  const mode = normalizeString(value).toLowerCase()
  if (mode === 'oidc' || mode === 'cas' || mode === 'wecom') return mode
  return 'none'
}

function getCloudflareEnv(event: H3Event): CloudflareRuntimeEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function runtimeEnvValue(event: H3Event, names: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const name of names) {
    const value = normalizeString(cloudflareEnv[name] || process.env[name])
    if (value) return value
  }
  return ''
}

function gatewayHeader(event: H3Event, name: string) {
  return isTrustedTenantGatewayRequest(event) ? normalizeString(getHeader(event, name)) : ''
}

function oidcGatewayValue(event: H3Event, header: string, envNames: string[], fallback: unknown = '') {
  return gatewayHeader(event, header) || runtimeEnvValue(event, envNames) || normalizeString(fallback)
}

function loginMode(event: H3Event, configuredMode: ConsoleLoginMode, fallbackEnabled: boolean, fallbackCas: boolean, fallbackWecom: boolean) {
  const gatewayMode = gatewayHeader(event, 'x-hzy-console-login-mode').toLowerCase()
  if (gatewayMode === 'oidc' || gatewayMode === 'cas' || gatewayMode === 'wecom' || gatewayMode === 'none') {
    return gatewayMode
  }

  if (configuredMode === 'oidc') return fallbackEnabled ? 'oidc' : 'none'
  if (configuredMode === 'cas') return fallbackCas ? 'cas' : 'none'
  if (configuredMode === 'wecom') return fallbackWecom ? 'wecom' : 'none'
  if (fallbackEnabled) return 'oidc'
  if (fallbackCas) return 'cas'
  if (fallbackWecom) return 'wecom'
  return 'none'
}

async function resolveBundleConsoleLoginConfig(event: H3Event): Promise<ConsoleLoginConfig | null> {
  try {
    const config = loadPlatformRuntimeConfig(event)
    const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
    let bundle = await readCachedBundle(config.bundleCacheDir, cacheScope)
    let invalidReason = getCachedBundleInvalidReason(bundle)

    if (config.activationMode === 'managed-cloud-multitenant' && invalidReason) {
      const refreshed = await refreshPlatformBundle('login-config-cache-miss', event).catch(() => null)
      if (refreshed?.ok && refreshed.bundle) {
        bundle = refreshed.bundle
        invalidReason = getCachedBundleInvalidReason(bundle)
      }
    }

    if (!bundle || invalidReason) return null

    const login = recordValue(bundle.payload?.consoleLogin)
    const oidc = recordValue(login.oidc)
    const cas = recordValue(login.cas)
    const wecom = recordValue(login.wecom)
    const mode = normalizeLoginMode(login.mode)
    const oidcIssuer = normalizeUrl(oidc.issuer)
    const oidcAuthorizationEndpoint = normalizeUrl(oidc.authorizationEndpoint)
    const oidcTokenEndpoint = normalizeUrl(oidc.tokenEndpoint)
    const oidcClientId = normalizeString(oidc.clientId)
    const casBaseUrl = normalizeUrl(cas.baseUrl)
    const wecomCorpid = normalizeString(wecom.corpid)
    const wecomAgentid = normalizeString(wecom.agentid)

    return {
      mode,
      oidc: {
        enabled: mode === 'oidc' && Boolean(oidcClientId && (oidcIssuer || (oidcAuthorizationEndpoint && oidcTokenEndpoint))),
        providerCode: normalizeString(oidc.providerCode) || 'sso_oidc',
        issuer: oidcIssuer,
        authorizationEndpoint: oidcAuthorizationEndpoint,
        tokenEndpoint: oidcTokenEndpoint,
        userinfoEndpoint: normalizeUrl(oidc.userinfoEndpoint),
        endSessionEndpoint: normalizeUrl(oidc.endSessionEndpoint),
        jwksUri: normalizeUrl(oidc.jwksUri),
        clientId: oidcClientId,
        clientSecret: normalizeString(oidc.clientSecret),
        scope: normalizeString(oidc.scope) || 'openid profile email'
      },
      cas: {
        enabled: mode === 'cas' && Boolean(casBaseUrl),
        baseUrl: casBaseUrl
      },
      wecom: {
        enabled: mode === 'wecom' && Boolean(wecomCorpid && wecomAgentid),
        corpid: wecomCorpid,
        agentid: wecomAgentid,
        corpsecret: normalizeString(wecom.corpsecret)
      }
    }
  } catch {
    return null
  }
}

export async function resolveConsoleLoginConfig(event: H3Event): Promise<ConsoleLoginConfig> {
  const runtimeConfig = useRuntimeConfig(event) as unknown as {
    auth?: {
      upstreamOidc?: Record<string, unknown>
    }
    public?: {
      casEnable?: boolean | string
      casBaseUrl?: string
    }
    wecom?: {
      corpid?: string
      corpsecret?: string
      agentid?: string
    }
  }
  const bundleConfig = await resolveBundleConsoleLoginConfig(event)
  const rawOidc = runtimeConfig.auth?.upstreamOidc || {}
  const envOidcEnabled = runtimeEnvValue(event, ['SSO_OIDC_ENABLE', 'OIDC_ENABLE'])
  const oidcIssuer = normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-issuer', ['SSO_OIDC_ISSUER', 'OIDC_ISSUER'], bundleConfig?.oidc.issuer || rawOidc.issuer))
  const oidcAuthorizationEndpoint = normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-authorization-endpoint', ['SSO_OIDC_AUTHORIZATION_ENDPOINT', 'OIDC_AUTHORIZATION_ENDPOINT'], bundleConfig?.oidc.authorizationEndpoint || rawOidc.authorizationEndpoint))
  const oidcTokenEndpoint = normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-token-endpoint', ['SSO_OIDC_TOKEN_ENDPOINT', 'OIDC_TOKEN_ENDPOINT'], bundleConfig?.oidc.tokenEndpoint || rawOidc.tokenEndpoint))
  const oidcClientId = oidcGatewayValue(event, 'x-hzy-sso-oidc-client-id', ['SSO_OIDC_CLIENT_ID', 'OIDC_CLIENT_ID'], bundleConfig?.oidc.clientId || rawOidc.clientId)
  const fallbackOidcEnabled = envOidcEnabled
    ? envOidcEnabled === 'true'
    : bundleConfig?.mode === 'oidc' || rawOidc.enabled === true
  const oidcEnabled = Boolean(
    (gatewayHeader(event, 'x-hzy-console-login-mode') === 'oidc' || fallbackOidcEnabled)
    && oidcClientId
    && (oidcIssuer || (oidcAuthorizationEndpoint && oidcTokenEndpoint))
  )

  const casBaseUrl = normalizeUrl(gatewayHeader(event, 'x-hzy-cas-base-url') || bundleConfig?.cas.baseUrl || normalizeString(runtimeConfig.public?.casBaseUrl))
  const fallbackCasEnabled = bundleConfig?.mode === 'cas'
    || runtimeConfig.public?.casEnable === true
    || normalizeString(runtimeConfig.public?.casEnable).toLowerCase() === 'true'
  const wecomCorpid = gatewayHeader(event, 'x-hzy-wecom-corpid') || bundleConfig?.wecom.corpid || normalizeString(runtimeConfig.wecom?.corpid)
  const wecomAgentid = gatewayHeader(event, 'x-hzy-wecom-agentid') || bundleConfig?.wecom.agentid || normalizeString(runtimeConfig.wecom?.agentid)
  const wecomCorpsecret = gatewayHeader(event, 'x-hzy-wecom-corpsecret') || bundleConfig?.wecom.corpsecret || normalizeString(runtimeConfig.wecom?.corpsecret)
  const fallbackWecomEnabled = bundleConfig?.mode === 'wecom' || Boolean(wecomCorpid && wecomAgentid)
  const mode = loginMode(
    event,
    bundleConfig?.mode || 'none',
    oidcEnabled,
    Boolean(fallbackCasEnabled && casBaseUrl),
    Boolean(fallbackWecomEnabled && wecomCorpid && wecomAgentid)
  )

  return {
    mode,
    oidc: {
      enabled: mode === 'oidc' && oidcEnabled,
      providerCode: oidcGatewayValue(event, 'x-hzy-sso-oidc-provider-code', ['SSO_OIDC_PROVIDER_CODE', 'OIDC_PROVIDER_CODE'], bundleConfig?.oidc.providerCode || rawOidc.providerCode) || 'sso_oidc',
      issuer: oidcIssuer,
      authorizationEndpoint: oidcAuthorizationEndpoint,
      tokenEndpoint: oidcTokenEndpoint,
      userinfoEndpoint: normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-userinfo-endpoint', ['SSO_OIDC_USERINFO_ENDPOINT', 'OIDC_USERINFO_ENDPOINT'], bundleConfig?.oidc.userinfoEndpoint || rawOidc.userinfoEndpoint)),
      endSessionEndpoint: normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-end-session-endpoint', ['SSO_OIDC_END_SESSION_ENDPOINT', 'OIDC_END_SESSION_ENDPOINT'], bundleConfig?.oidc.endSessionEndpoint || rawOidc.endSessionEndpoint)),
      jwksUri: normalizeUrl(oidcGatewayValue(event, 'x-hzy-sso-oidc-jwks-uri', ['SSO_OIDC_JWKS_URI', 'OIDC_JWKS_URI'], bundleConfig?.oidc.jwksUri || rawOidc.jwksUri)),
      clientId: oidcClientId,
      clientSecret: oidcGatewayValue(event, 'x-hzy-sso-oidc-client-secret', ['SSO_OIDC_CLIENT_SECRET', 'OIDC_CLIENT_SECRET'], bundleConfig?.oidc.clientSecret || rawOidc.clientSecret),
      scope: oidcGatewayValue(event, 'x-hzy-sso-oidc-scope', ['SSO_OIDC_SCOPE', 'OIDC_SCOPE'], bundleConfig?.oidc.scope || rawOidc.scope) || 'openid profile email'
    },
    cas: {
      enabled: mode === 'cas' && Boolean(casBaseUrl),
      baseUrl: casBaseUrl
    },
    wecom: {
      enabled: mode === 'wecom' && Boolean(wecomCorpid && wecomAgentid),
      corpid: wecomCorpid,
      agentid: wecomAgentid,
      corpsecret: wecomCorpsecret
    }
  }
}

export async function publicConsoleLoginConfig(event: H3Event) {
  const config = await resolveConsoleLoginConfig(event)
  return {
    mode: config.mode,
    ssoOidcEnable: config.oidc.enabled,
    casEnable: config.cas.enabled,
    wecomCorpid: config.wecom.corpid,
    wecomAgentid: config.wecom.agentid
  }
}
