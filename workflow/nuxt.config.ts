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
  const normalized = stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized ? `/${normalized}/` : '/'
}

const configuredConsoleUrl = process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const appCode = process.env.HZY_APP_CODE || 'workflow'
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
const appBasePath = normalizeNuxtBaseURL(
  process.env.NUXT_APP_BASE_URL
  || process.env.HZY_APP_BASE_PATH
  || defaultBasePathFromAppCode(appCode)
)

function withAppBase(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${appBasePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
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

  css: [
    '~/assets/css/main.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css'
  ],

  ui: {
    fonts: false
  },

  runtimeConfig: {
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      dataAccessMode: process.env.HZY_WORKFLOW_DATA_ACCESS_MODE || process.env.HZY_DATA_ACCESS_MODE || 'tenant-runtime',
      tenantRuntime: {
        endpoint: process.env.HZY_WORKFLOW_TENANT_RUNTIME_URL || process.env.HZY_TENANT_RUNTIME_URL || process.env.HZY_WORKFLOW_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
        token: process.env.HZY_WORKFLOW_TENANT_RUNTIME_TOKEN || process.env.HZY_TENANT_RUNTIME_TOKEN || process.env.HZY_WORKFLOW_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || '',
        audience: process.env.HZY_DATA_RUNTIME_AUDIENCE || process.env.HZY_TENANT_RUNTIME_AUDIENCE || 'data-runtime',
        tenant: process.env.HZY_TENANT_RUNTIME_TENANT || process.env.HZY_DATA_RUNTIME_TENANT || process.env.HZY_PLATFORM_TENANT_CODE || '',
        deployment: process.env.HZY_TENANT_RUNTIME_DEPLOYMENT || process.env.HZY_DATA_RUNTIME_DEPLOYMENT || process.env.HZY_PLATFORM_DEPLOYMENT_CODE || ''
      },
      consoleRuntime: {
        consoleApiUrl: defaultConsoleUrl,
        enabled: process.env.HZY_CONSOLE_RUNTIME_ENABLED || ''
      },
      directory: {
        provider: process.env.HZY_DIRECTORY_PROVIDER || 'console',
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
      },
      serviceClient: {
        clientId: process.env.HZY_SERVICE_CLIENT_ID || '',
        clientSecret: process.env.HZY_SERVICE_CLIENT_SECRET || '',
        tokenUrl: process.env.HZY_CONSOLE_TOKEN_URL || ''
      }
    },
    public: {
      appName: packageMeta.name || 'workflow',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云流程',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-route',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || withAppBase('/logo.png'),
      deploymentProfile,
      deploymentPublicUrl,
      consoleUrl: defaultConsoleUrl,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      appCode,
      appBasePath
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  devServer: {
    port: 3020
  },

  experimental: {
    appManifest: false,
    payloadExtraction: false
  },

  compatibilityDate: '2026-01-19',

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
  },

  // @ts-expect-error fonts: false 禁用 @nuxt/fonts（由 @nuxt/ui 引入）
  fonts: false
})
