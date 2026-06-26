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
    process.env.NUXT_PUBLIC_APP_BASE_PATH
    || process.env.NUXT_APP_BASE_URL
    || process.env.HZY_APP_BASE_PATH
    || defaultBasePathFromAppCode(appCode)
  )
}

function withAppBase(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${appBasePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

const configuredConsoleUrl = process.env.NUXT_PUBLIC_CONSOLE_URL || process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const appCode = process.env.NUXT_PUBLIC_APP_CODE || process.env.HZY_APP_CODE || 'altoc'
const appBasePath = resolveAppBasePath(appCode)
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const publicAuthMode = process.env.NUXT_PUBLIC_AUTH_MODE || process.env.HZY_AUTH_MODE || ''
const publicLegacyAuthBridge = (process.env.NUXT_PUBLIC_LEGACY_AUTH_BRIDGE || process.env.HZY_LEGACY_AUTH_BRIDGE) === 'true'
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
const deploymentPublicHost = (() => {
  try {
    return deploymentPublicUrl ? new URL(deploymentPublicUrl).hostname : ''
  } catch {
    return ''
  }
})()

function siblingAppUrl(siblingAppCode: string, devUrl: string) {
  return deploymentPublicUrl
    ? `${deploymentPublicUrl.replace(/\/+$/, '')}/${siblingAppCode}`
    : devUrl.replace(/\/+$/, '')
}

function resolvePublicHmrConfig() {
  if (!deploymentPublicUrl) return null

  try {
    const url = new URL(deploymentPublicUrl)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null

    const protocol = stringValue(process.env.VITE_HMR_PROTOCOL || process.env.NUXT_VITE_HMR_PROTOCOL)
      || (url.protocol === 'https:' ? 'wss' : 'ws')
    const clientPort = Number(process.env.VITE_HMR_CLIENT_PORT || process.env.NUXT_VITE_HMR_CLIENT_PORT)
      || Number(url.port)
      || (protocol === 'wss' ? 443 : 80)

    return {
      protocol,
      host: stringValue(process.env.VITE_HMR_HOST || process.env.NUXT_VITE_HMR_HOST) || url.hostname,
      clientPort
    }
  } catch {
    return null
  }
}

const codocsBaseUrl = siblingAppUrl('codocs', 'http://localhost:3001')

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
        { rel: 'icon', type: 'image/png', href: `${withAppBase('/logo.png')}?v=${packageMeta.version || 'dev'}` }
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
      defaultCompanyCode: process.env.HZY_DEFAULT_COMPANY_CODE || 'C000001',
      dataAccessMode: process.env.HZY_ALTOC_DATA_ACCESS_MODE || process.env.HZY_DATA_ACCESS_MODE || 'tenant-runtime',
      tenantRuntime: {
        endpoint: process.env.HZY_ALTOC_TENANT_RUNTIME_URL || process.env.HZY_TENANT_RUNTIME_URL || process.env.HZY_ALTOC_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
        token: process.env.HZY_ALTOC_TENANT_RUNTIME_TOKEN || process.env.HZY_TENANT_RUNTIME_TOKEN || process.env.HZY_ALTOC_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || '',
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
    codocsApiUrl: codocsBaseUrl,
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME || packageMeta.name || 'altoc',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云经营',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-handshake',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || withAppBase('/logo.png'),
      deploymentProfile,
      deploymentPublicUrl,
      appBasePath,
      appHomeUrl: process.env.NUXT_PUBLIC_APP_HOME_URL || process.env.HZY_APP_HOME_URL || '',
      consoleUrl: defaultConsoleUrl,
      authMode: publicAuthMode,
      legacyAuthBridge: publicLegacyAuthBridge,
      appCode,
      accountUrl: defaultConsoleUrl,
      codocsBaseUrl
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
    },
    server: {
      allowedHosts: [
        'altoc.isme.dev',
        ...(deploymentPublicHost ? [deploymentPublicHost] : [])
      ]
    }
  },

  hooks: {
    'vite:extendConfig'(config, { isClient, isServer }) {
      if (process.env.NODE_ENV === 'production') {
        return
      }

      const hmrPort = Number(process.env.NUXT_VITE_HMR_PORT || process.env.VITE_HMR_PORT) || 24683

      if (!config.server) {
        try {
          (config as Record<string, unknown>).server = {}
        } catch {
          return
        }
      }

      if (!config.server) {
        return
      }

      if (isServer) {
        config.server.hmr = false
        return
      }

      if (isClient) {
        config.server.hmr = resolvePublicHmrConfig() || {
          protocol: 'ws',
          host: 'localhost',
          port: hmrPort,
          clientPort: hmrPort
        }
      }
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
