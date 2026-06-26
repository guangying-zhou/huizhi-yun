import { fileURLToPath } from 'node:url'
import pkg from './package.json'

const packageMeta = pkg as { version?: string }

function normalizeNuxtBaseURL(value: unknown) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === '/') return '/'
  if (!normalized.startsWith('/')) return '/'
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function defaultBasePathFromAppCode(value: unknown) {
  const appCode = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return appCode ? `/${appCode}/` : '/'
}

function resolveAppBasePath(appCode: string) {
  return normalizeNuxtBaseURL(
    process.env.NUXT_APP_BASE_URL
    || process.env.HZY_APP_BASE_PATH
    || defaultBasePathFromAppCode(appCode)
  )
}

function splitEnvList(value: unknown) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeAllowedHost(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname
    }
  } catch {
    return ''
  }

  return raw
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

const appCode = process.env.HZY_APP_CODE || 'console'
const appBasePath = resolveAppBasePath(appCode)
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const viteAllowedHosts = Array.from(new Set(
  splitEnvList(process.env.NUXT_VITE_ALLOWED_HOSTS || process.env.VITE_ALLOWED_HOSTS)
    .map(normalizeAllowedHost)
    .filter(Boolean)
))
const upstreamOidcEnabled = process.env.SSO_OIDC_ENABLE === 'true' || process.env.OIDC_ENABLE === 'true'
const upstreamOidcIssuer = process.env.SSO_OIDC_ISSUER || process.env.OIDC_ISSUER || ''
const upstreamOidcAuthorizationEndpoint = process.env.SSO_OIDC_AUTHORIZATION_ENDPOINT || process.env.OIDC_AUTHORIZATION_ENDPOINT || ''
const upstreamOidcTokenEndpoint = process.env.SSO_OIDC_TOKEN_ENDPOINT || process.env.OIDC_TOKEN_ENDPOINT || ''
const upstreamOidcClientId = process.env.SSO_OIDC_CLIENT_ID || process.env.OIDC_CLIENT_ID || ''
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'

function withAppBase(path: string) {
  const baseURL = appBasePath
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${baseURL}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

function resolveAppAsset(path: string, fallback: string) {
  const value = String(path || '').trim()
  if (!value) return withAppBase(fallback)
  if (/^(https?:)?\/\//.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value
  if (value.startsWith(appBasePath)) return value
  if (value.startsWith('/')) return withAppBase(value)
  return value
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['@hzy/foundation'],

  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt'],

  ssr: false,

  devtools: {
    enabled: false
  },

  app: {
    baseURL: appBasePath,
    head: {
      link: [
        { rel: 'icon', type: 'image/png', sizes: '64x64', href: `${withAppBase('/favicon.png')}?v=${packageMeta.version || 'dev'}` }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    storageKey: 'hzy-color-mode'
  },

  ui: {
    fonts: false
  },

  runtimeConfig: {
    db: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      name: process.env.DB_NAME || 'hzy_console',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10'),
      ssl: process.env.DB_SSL || '',
      sslCa: process.env.DB_SSL_CA || '',
      sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    },
    // Workflow API for Foundation workflow proxy; no Account API credentials are configured here.
    hzy: {
      deploymentProfile,
      workflowApiUrl: process.env.HZY_WORKFLOW_API_URL || 'http://localhost:3020'
    },
    auth: {
      sessionTtlSeconds: Number(process.env.CONSOLE_AUTH_SESSION_TTL_SECONDS || '28800'),
      cookieMode: process.env.CONSOLE_AUTH_COOKIE_MODE || 'dual',
      legacyCookieFallback: process.env.AUTH_LEGACY_COOKIE_FALLBACK !== 'false',
      oidcIssuer: process.env.CONSOLE_OIDC_ISSUER || '',
      upstreamOidc: {
        enabled: upstreamOidcEnabled,
        providerCode: process.env.SSO_OIDC_PROVIDER_CODE || process.env.OIDC_PROVIDER_CODE || 'sso_oidc',
        issuer: upstreamOidcIssuer,
        authorizationEndpoint: upstreamOidcAuthorizationEndpoint,
        tokenEndpoint: upstreamOidcTokenEndpoint,
        userinfoEndpoint: process.env.SSO_OIDC_USERINFO_ENDPOINT || process.env.OIDC_USERINFO_ENDPOINT || '',
        endSessionEndpoint: process.env.SSO_OIDC_END_SESSION_ENDPOINT || process.env.OIDC_END_SESSION_ENDPOINT || '',
        jwksUri: process.env.SSO_OIDC_JWKS_URI || process.env.OIDC_JWKS_URI || '',
        clientId: upstreamOidcClientId,
        clientSecret: process.env.SSO_OIDC_CLIENT_SECRET || process.env.OIDC_CLIENT_SECRET || '',
        redirectUri: process.env.SSO_OIDC_REDIRECT_URI || process.env.OIDC_REDIRECT_URI || '',
        scope: process.env.SSO_OIDC_SCOPE || process.env.OIDC_SCOPE || 'openid profile email',
        postLogoutRedirectUri: process.env.SSO_OIDC_POST_LOGOUT_REDIRECT_URI || process.env.OIDC_POST_LOGOUT_REDIRECT_URI || ''
      },
      signingKeyDir: process.env.CONSOLE_AUTH_SIGNING_KEY_DIR || '.data/auth-runtime/signing-keys',
      simulationSecret: process.env.CONSOLE_AUTH_SIMULATION_SECRET || process.env.HZY_CONSOLE_AUTH_SIMULATION_SECRET || '',
      authorizationCodeTtlSeconds: Number(process.env.CONSOLE_AUTH_CODE_TTL_SECONDS || '300'),
      accessTokenTtlSeconds: Number(process.env.CONSOLE_ACCESS_TOKEN_TTL_SECONDS || '900'),
      refreshTokenTtlSeconds: Number(process.env.CONSOLE_REFRESH_TOKEN_TTL_SECONDS || '2592000')
    },
    // 测试模式：通知重定向（留空则正常发送）
    notifyRedirectTo: process.env.NOTIFY_REDIRECT_TO || '',
    // 企业微信 OAuth（免登录）
    wecom: {
      corpid: process.env.WECOM_CORPID || '',
      corpsecret: process.env.WECOM_CORPSECRET || '',
      agentid: process.env.WECOM_AGENTID || ''
    },
    platform: {
      activationMode: process.env.HZY_CONSOLE_ACTIVATION_MODE || process.env.CONSOLE_ACTIVATION_MODE || '',
      baseUrl: process.env.HZY_PLATFORM_URL || process.env.PLATFORM_BASE_URL || '',
      tenantCode: process.env.HZY_PLATFORM_TENANT_CODE || process.env.TENANT_CODE || '',
      deploymentCode: process.env.HZY_PLATFORM_DEPLOYMENT_CODE || process.env.DEPLOYMENT_CODE || '',
      environment: process.env.HZY_PLATFORM_ENVIRONMENT || process.env.HZY_DEPLOYMENT_ENVIRONMENT || process.env.DEPLOYMENT_ENVIRONMENT || '',
      runtimeToken: process.env.HZY_PLATFORM_RUNTIME_TOKEN || process.env.RUNTIME_TOKEN || process.env.PLATFORM_RUNTIME_TOKEN || '',
      platformServiceToken: process.env.HZY_CLOUDFLARE_INTERNAL_TOKEN || process.env.HZY_CONSOLE_PLATFORM_SERVICE_TOKEN || process.env.HZY_PLATFORM_INTERNAL_SERVICE_TOKEN || process.env.PLATFORM_INTERNAL_SERVICE_TOKEN || '',
      signingKid: process.env.HZY_PLATFORM_SIGNING_KID || process.env.PLATFORM_SIGNING_KID || '',
      signingPubkey: process.env.HZY_PLATFORM_SIGNING_PUBKEY || process.env.PLATFORM_SIGNING_PUBKEY || '',
      licenseToken: process.env.HZY_PLATFORM_LICENSE_TOKEN || process.env.PLATFORM_LICENSE_TOKEN || '',
      licensePath: process.env.HZY_PLATFORM_LICENSE_PATH || process.env.PLATFORM_LICENSE_PATH || '',
      bundleCacheDir: process.env.HZY_PLATFORM_BUNDLE_CACHE_DIR || process.env.PLATFORM_BUNDLE_CACHE_DIR || '',
      heartbeatIntervalMs: Number(process.env.HZY_PLATFORM_HEARTBEAT_INTERVAL_MS || process.env.PLATFORM_HEARTBEAT_INTERVAL_MS || '300000'),
      runtimeEnabled: process.env.HZY_PLATFORM_RUNTIME_ENABLED || process.env.PLATFORM_RUNTIME_ENABLED || '',
      heartbeatEnabled: process.env.HZY_PLATFORM_HEARTBEAT_ENABLED || process.env.PLATFORM_HEARTBEAT_ENABLED || '',
      bundleRefreshOnBoot: process.env.HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT || process.env.PLATFORM_BUNDLE_REFRESH_ON_BOOT || '',
      authClientMaterialize: process.env.HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE || process.env.PLATFORM_AUTH_CLIENT_MATERIALIZE || ''
    },
    consoleRuntime: {
      activationMode: process.env.HZY_CONSOLE_ACTIVATION_MODE || process.env.CONSOLE_ACTIVATION_MODE || '',
      runMode: process.env.HZY_CONSOLE_RUN_MODE || process.env.CONSOLE_RUN_MODE || '',
      backgroundJobsEnabled: process.env.HZY_CONSOLE_BACKGROUND_JOBS_ENABLED || process.env.CONSOLE_BACKGROUND_JOBS_ENABLED || '',
      devPolicyBypass: process.env.HZY_CONSOLE_DEV_POLICY_BYPASS || process.env.CONSOLE_DEV_POLICY_BYPASS || '',
      collabMode: process.env.CONSOLE_COLLAB_MODE || process.env.HZY_COLLAB_MODE || process.env.COLLAB_RUNTIME_MODE || '',
      cloudflareRuntime: process.env.HZY_CLOUDFLARE_RUNTIME || process.env.HZY_CLOUDFLARE_BUILD || ''
    },
    vault: {
      masterKey: process.env.HZY_CONSOLE_VAULT_MASTER_KEY || process.env.CONSOLE_VAULT_MASTER_KEY || ''
    },
    public: {
      appCode,
      appName: pkg.name,
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '企业控制台',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-monitor-cog',
      appLogo: resolveAppAsset(process.env.NUXT_PUBLIC_APP_LOGO || '', '/logo.svg'),
      deploymentProfile,
      deploymentPublicUrl: process.env.HZY_DEPLOYMENT_PUBLIC_URL || '',
      appBasePath,
      appHomeUrl: process.env.HZY_APP_HOME_URL || process.env.NUXT_PUBLIC_APP_HOME_URL || '',
      ssoOidcEnable: Boolean(upstreamOidcEnabled && upstreamOidcClientId && (upstreamOidcIssuer || (upstreamOidcAuthorizationEndpoint && upstreamOidcTokenEndpoint))),
      casEnable: process.env.CAS_ENABLE == 'true',
      // CAS 服务端基础地址（不含路径），例如：https://cas.wiztek.cn:8443
      casBaseUrl: process.env.CAS_BASE_URL || 'https://cas.wiztek.cn:8443',
      // 迁移期 fallback；统一域名部署优先使用 HZY_DEPLOYMENT_PUBLIC_URL + HZY_APP_BASE_PATH。
      serviceUrl: process.env.CAS_SERVICE_URL || '',
      // 企业微信（客户端需要 corpid 和 agentid 构建 OAuth URL）
      wecomCorpid: process.env.WECOM_CORPID || '',
      wecomAgentid: process.env.WECOM_AGENTID || ''
    }
  },

  build: {
    transpile: isCloudflareBuild ? [] : ['collab', '@hzy/authz-core']
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  devServer: {
    port: 3000
  },

  experimental: {
    appManifest: false,
    payloadExtraction: false
  },

  compatibilityDate: '2026-01-19',

  nitro: {
    alias: {
      ...(isCloudflareBuild
        ? {
            'ali-oss': fileURLToPath(new URL('./server/shims/ali-oss.ts', import.meta.url)),
            'safer-buffer': fileURLToPath(new URL('./server/shims/safer-buffer.ts', import.meta.url))
          }
        : {})
    },
    ...(isCloudflareBuild
      ? {}
      : {
          externals: {
            inline: ['collab']
          }
        }),
    cloudflare: {
      deployConfig: false,
      nodeCompat: true
    },
    experimental: {
      asyncContext: true
    }
  },

  vite: {
    ...(viteAllowedHosts.length > 0 ? { server: { allowedHosts: viteAllowedHosts } } : {}),
    build: {
      sourcemap: false
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // @ts-expect-error fonts: false 禁用 @nuxt/fonts（由 @nuxt/ui 引入）
  fonts: false
})
