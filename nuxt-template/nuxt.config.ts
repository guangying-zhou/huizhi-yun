import pkg from './package.json'

const configuredConsoleUrl = process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const appCode = process.env.HZY_APP_CODE || pkg.name

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['@hzy/foundation'],

  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt'],

  ssr: false,

  devtools: {
    enabled: false
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
      name: process.env.DB_NAME || 'hzy_template',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10')
    },
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
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
      appCode,
      appName: pkg.name,
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云模块',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '/logo.png',
      deploymentProfile,
      deploymentPublicUrl,
      consoleUrl: defaultConsoleUrl,
      accountUrl: defaultConsoleUrl,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true'
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
