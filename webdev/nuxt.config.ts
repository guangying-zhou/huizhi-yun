import { fileURLToPath } from 'node:url'
import pkg from './package.json'

const packageMeta = pkg as { name?: string, version?: string }

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeNuxtBaseURL(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized || normalized === '/') return '/'
  if (!normalized.startsWith('/')) return '/'
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function defaultBasePathFromAppCode(value: unknown) {
  const appCode = stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return appCode ? `/${appCode}/` : '/'
}

const configuredConsoleUrl = process.env.NUXT_PUBLIC_CONSOLE_URL || process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || (process.env.NODE_ENV === 'production' ? 'https://console.huizhi.yun' : 'http://localhost:3000')
const appCode = process.env.NUXT_PUBLIC_APP_CODE || process.env.HZY_APP_CODE || 'webdev'
const appBasePath = normalizeNuxtBaseURL(process.env.NUXT_PUBLIC_APP_BASE_PATH || process.env.NUXT_APP_BASE_URL || process.env.HZY_APP_BASE_PATH || defaultBasePathFromAppCode(appCode))
const publicAuthMode = process.env.NUXT_PUBLIC_AUTH_MODE || process.env.HZY_AUTH_MODE || ''
const publicLegacyAuthBridge = (process.env.NUXT_PUBLIC_LEGACY_AUTH_BRIDGE || process.env.HZY_LEGACY_AUTH_BRIDGE) === 'true'
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
  || process.env.NITRO_PRESET === 'cloudflare_module'
  || process.env.NUXT_NITRO_PRESET === 'cloudflare_module'

export default defineNuxtConfig({
  extends: ['@hzy/foundation'],

  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt'],

  ssr: false,

  devtools: {
    enabled: false
  },

  app: {
    baseURL: appBasePath
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    storageKey: 'hzy-webdev-color-mode'
  },

  ui: {
    fonts: false
  },

  runtimeConfig: {
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      tenantGateway: {
        token: process.env.HZY_TENANT_GATEWAY_TOKEN || ''
      },
      consoleRuntime: {
        consoleApiUrl: defaultConsoleUrl,
        enabled: process.env.HZY_CONSOLE_RUNTIME_ENABLED || ''
      },
      directory: {
        provider: process.env.HZY_DIRECTORY_PROVIDER || (defaultConsoleUrl ? 'console' : ''),
        consoleApiUrl: defaultConsoleUrl,
        consoleClientId: process.env.HZY_CONSOLE_CLIENT_ID || '',
        consoleClientSecret: process.env.HZY_CONSOLE_CLIENT_SECRET || '',
        timeoutMs: Number(process.env.HZY_DIRECTORY_TIMEOUT_MS || '10000')
      },
      integration: {
        consoleApiUrl: defaultConsoleUrl
      },
      consoleOidc: {
        issuer: process.env.HZY_CONSOLE_OIDC_ISSUER || defaultConsoleUrl,
        clientId: process.env.HZY_CONSOLE_OIDC_CLIENT_ID || appCode,
        redirectUri: process.env.HZY_CONSOLE_OIDC_REDIRECT_URI || '',
        logoutRedirectUri: process.env.HZY_CONSOLE_OIDC_LOGOUT_REDIRECT_URI || '',
        scope: process.env.HZY_CONSOLE_OIDC_SCOPE || 'openid offline_access'
      }
    },
    webdev: {
      allowedUids: process.env.HZY_WEBDEV_ALLOWED_UIDS || '',
      requireAppGrant: process.env.HZY_WEBDEV_REQUIRE_APP_GRANT || ''
    },
    devAgent: {
      baseUrl: process.env.HZY_WEBDEV_DEV_AGENT_URL || 'http://127.0.0.1:19090',
      token: process.env.HZY_WEBDEV_DEV_AGENT_TOKEN || ''
    },
    dataRuntime: {
      baseUrl: process.env.HZY_WEBDEV_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
      token: process.env.HZY_WEBDEV_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || ''
    },
    public: {
      appCode,
      appName: packageMeta.name || 'webdev',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || 'WebDev',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-terminal',
      deploymentProfile,
      deploymentPublicUrl,
      appBasePath,
      appHomeUrl: process.env.HZY_APP_HOME_URL || process.env.NUXT_PUBLIC_APP_HOME_URL || '',
      consoleUrl: defaultConsoleUrl,
      accountUrl: defaultConsoleUrl,
      authMode: publicAuthMode,
      legacyAuthBridge: publicLegacyAuthBridge,
      devAgentConfigured: Boolean(process.env.HZY_WEBDEV_DEV_AGENT_URL)
    }
  },

  routeRules: {
    '/api/**': {
      cors: false
    }
  },

  experimental: {
    appManifest: false,
    payloadExtraction: false
  },

  compatibilityDate: '2026-05-26',

  nitro: {
    alias: {
      'safer-buffer': fileURLToPath(new URL('./server/shims/safer-buffer.ts', import.meta.url)),
      ...(isCloudflareBuild
        ? {
            'ali-oss': fileURLToPath(new URL('./server/shims/ali-oss.ts', import.meta.url))
          }
        : {})
    },
    cloudflare: {
      deployConfig: false,
      nodeCompat: true
    },
    experimental: {
      asyncContext: true
    }
  },

  vite: {
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
  }
})
