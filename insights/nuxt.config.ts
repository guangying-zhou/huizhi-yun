import pkg from './package.json'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt'],

  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],

  ui: {
    fonts: false
  },

  runtimeConfig: {
    db: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      name: process.env.DB_NAME || 'hzy_repoinsight',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10')
    },
    hzy: {
      apiBaseUrl: process.env.HZY_ACCOUNT_API_URL,
      apiKey: process.env.HZY_ACCOUNT_API_KEY,
      apiSecret: process.env.HZY_ACCOUNT_API_SECRET
    },
    pythonBackendUrl: process.env.PYTHON_BACKEND_URL || 'http://localhost:8000',
    public: {
      casEnable: process.env.CAS_ENABLE === 'true',
      casBaseUrl: process.env.CAS_BASE_URL || 'https://cas.wiztek.cn:8443',
      serviceUrl: process.env.CAS_SERVICE_URL || '',
      appName: pkg.name,
      accountUrl: process.env.HZY_ACCOUNT_URL || process.env.HZY_ACCOUNT_API_URL || 'http://localhost:3000',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '代码洞察',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '/logo.png'
    }
  },

  routeRules: { '/api/**': { cors: true } },
  experimental: { appManifest: false, payloadExtraction: false },
  compatibilityDate: '2026-01-19',
  vite: { build: { sourcemap: false } },
  eslint: {
    config: { stylistic: { commaDangle: 'never', braceStyle: '1tbs' } }
  },
  fonts: false
})
