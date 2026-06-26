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
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const appCode = process.env.NUXT_PUBLIC_APP_CODE || process.env.HZY_APP_CODE || 'finance'
const appBasePath = normalizeNuxtBaseURL(process.env.NUXT_PUBLIC_APP_BASE_PATH || process.env.NUXT_APP_BASE_URL || process.env.HZY_APP_BASE_PATH || defaultBasePathFromAppCode(appCode))
const publicAuthMode = process.env.NUXT_PUBLIC_AUTH_MODE || process.env.HZY_AUTH_MODE || ''
const publicLegacyAuthBridge = (process.env.NUXT_PUBLIC_LEGACY_AUTH_BRIDGE || process.env.HZY_LEGACY_AUTH_BRIDGE) === 'true'
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
  || process.env.NITRO_PRESET === 'cloudflare_module'
  || process.env.NUXT_NITRO_PRESET === 'cloudflare_module'

function withAppBase(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${appBasePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

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
        { rel: 'icon', type: 'image/x-icon', href: `${withAppBase('/favicon.ico')}?v=${packageMeta.version || 'dev'}` }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
    storageKey: 'hzy-color-mode'
  },

  ui: {
    fonts: false
  },

  runtimeConfig: {
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      workflowApiUrl: process.env.HZY_WORKFLOW_API_URL || '',
      dataAccessMode: process.env.HZY_FINANCE_DATA_ACCESS_MODE || process.env.HZY_DATA_ACCESS_MODE || 'tenant-runtime',
      tenantRuntime: {
        endpoint: process.env.HZY_FINANCE_TENANT_RUNTIME_URL || process.env.HZY_TENANT_RUNTIME_URL || process.env.HZY_FINANCE_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
        token: process.env.HZY_FINANCE_TENANT_RUNTIME_TOKEN || process.env.HZY_TENANT_RUNTIME_TOKEN || process.env.HZY_FINANCE_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || '',
        audience: process.env.HZY_DATA_RUNTIME_AUDIENCE || process.env.HZY_TENANT_RUNTIME_AUDIENCE || 'data-runtime',
        tenant: process.env.HZY_TENANT_RUNTIME_TENANT || process.env.HZY_DATA_RUNTIME_TENANT || process.env.HZY_PLATFORM_TENANT_CODE || '',
        deployment: process.env.HZY_TENANT_RUNTIME_DEPLOYMENT || process.env.HZY_DATA_RUNTIME_DEPLOYMENT || process.env.HZY_PLATFORM_DEPLOYMENT_CODE || ''
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
      serviceClient: {
        clientId: process.env.HZY_SERVICE_CLIENT_ID || '',
        clientSecret: process.env.HZY_SERVICE_CLIENT_SECRET || '',
        tokenUrl: process.env.HZY_CONSOLE_TOKEN_URL || ''
      },
      financeDevPermissions: process.env.HZY_FINANCE_DEV_PERMISSIONS === 'true'
    },
    public: {
      appCode,
      appName: process.env.NUXT_PUBLIC_APP_NAME || '汇智云财务',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云财务',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-receipt-text',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '',
      deploymentProfile,
      deploymentPublicUrl,
      appBasePath,
      appHomeUrl: process.env.NUXT_PUBLIC_APP_HOME_URL || process.env.HZY_APP_HOME_URL || '',
      consoleUrl: defaultConsoleUrl,
      authMode: publicAuthMode,
      legacyAuthBridge: publicLegacyAuthBridge,
      accountUrl: process.env.NUXT_PUBLIC_ACCOUNT_URL || defaultConsoleUrl,
      financeDevPermissions: process.env.HZY_FINANCE_DEV_PERMISSIONS === 'true'
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
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
  }
})
