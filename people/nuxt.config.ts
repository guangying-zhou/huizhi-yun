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

function resolveAppBasePath(appCode: string) {
  return normalizeNuxtBaseURL(
    process.env.NUXT_APP_BASE_URL
    || process.env.HZY_APP_BASE_PATH
    || defaultBasePathFromAppCode(appCode)
  )
}

function withAppBase(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${appBasePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

const configuredConsoleUrl = process.env.HZY_CONSOLE_RUNTIME_API_URL || process.env.HZY_CONSOLE_API_URL || process.env.HZY_CONSOLE_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const appCode = process.env.HZY_APP_CODE || 'people'
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
const appBasePath = resolveAppBasePath(appCode)

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
        { rel: 'icon', type: 'image/x-icon', href: `${withAppBase('/favicon.ico')}?v=${packageMeta.version || 'dev'}` },
        { rel: 'shortcut icon', type: 'image/x-icon', href: `${withAppBase('/favicon.ico')}?v=${packageMeta.version || 'dev'}` }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  ui: {
    fonts: false
  },

  runtimeConfig: {
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      dataAccessMode: process.env.HZY_PEOPLE_DATA_ACCESS_MODE || process.env.HZY_DATA_ACCESS_MODE || 'tenant-runtime',
      tenantRuntime: {
        endpoint: process.env.HZY_PEOPLE_TENANT_RUNTIME_URL || process.env.HZY_TENANT_RUNTIME_URL || process.env.HZY_PEOPLE_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
        token: process.env.HZY_PEOPLE_TENANT_RUNTIME_TOKEN || process.env.HZY_TENANT_RUNTIME_TOKEN || process.env.HZY_PEOPLE_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || '',
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
      }
    },
    public: {
      appName: packageMeta.name || 'people',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || 'People 人员',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-users',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '',
      deploymentProfile,
      deploymentPublicUrl,
      appBasePath,
      appHomeUrl: process.env.HZY_APP_HOME_URL || process.env.NUXT_PUBLIC_APP_HOME_URL || '',
      consoleUrl: defaultConsoleUrl,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      appCode,
      accountUrl: defaultConsoleUrl
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
