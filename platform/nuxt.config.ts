import { fileURLToPath } from 'node:url'
import pkg from './package.json'

const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || 'platform-cloud-db'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt'],

  ssr: false,

  devtools: {
    enabled: process.env.NUXT_DEVTOOLS === 'true'
  },

  css: [
    '~/assets/css/main.css',
    '~/assets/css/console-tokens.css',
    '~/assets/css/console.css'
  ],

  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
    disableTransition: true,
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
      name: process.env.DB_NAME || 'hzy_platform',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10')
    },
    identity: {
      providerMode: process.env.IDENTITY_PROVIDER_MODE || 'oidc-first',
      gitlabBaseUrl: process.env.GITLAB_BASE_URL || '',
      casBaseUrl: process.env.CAS_BASE_URL || '',
      wecomEnabled: process.env.WECOM_ENABLED === 'true'
    },
    gitlab: {
      baseUrl: process.env.GITLAB_BASE_URL || '',
      token: process.env.GITLAB_BOT_TOKEN || process.env.GITLAB_API_TOKEN || '',
      defaultManifestPath: process.env.GITLAB_DEFAULT_APP_MANIFEST_PATH || 'app.manifest.json',
      requestTimeoutMs: Number(process.env.GITLAB_REQUEST_TIMEOUT_MS || '15000')
    },
    security: {
      opsUids: process.env.PLATFORM_OPS_UIDS || process.env.USER || '',
      opsBootstrapUids: process.env.PLATFORM_BOOTSTRAP_OPS_UIDS || process.env.PLATFORM_OPS_UIDS || process.env.USER || '',
      enableOpsRbac: process.env.PLATFORM_ENABLE_OPS_RBAC || 'true',
      allowOpsUidFallback: process.env.PLATFORM_ALLOW_OPS_UID_FALLBACK || 'true',
      allowLegacyAdminApi: process.env.PLATFORM_ALLOW_LEGACY_ADMIN_API || 'false',
      internalServiceTokens: [
        process.env.HZY_CLOUDFLARE_INTERNAL_TOKEN,
        process.env.PLATFORM_INTERNAL_SERVICE_TOKENS,
        process.env.PLATFORM_INTERNAL_SERVICE_TOKEN
      ].filter(Boolean).join(','),
      platformApiSunsetAt: process.env.PLATFORM_API_SUNSET_AT || '2026-07-31T23:59:59Z',
      platformSigningKeyDir: process.env.PLATFORM_SIGNING_KEY_DIR || ''
    },
    auth: {
      devMockEnabled: process.env.NODE_ENV !== 'production' && process.env.PLATFORM_AUTH_DEV_MOCK !== 'false',
      devUid: process.env.PLATFORM_AUTH_DEV_UID || process.env.PLATFORM_OPS_UIDS || process.env.USER || 'dev-admin',
      devDisplayName: process.env.PLATFORM_AUTH_DEV_DISPLAY_NAME || '',
      sessionTtlSeconds: Number(process.env.PLATFORM_AUTH_SESSION_TTL_SECONDS || '28800'),
      resendApiKey: process.env.RESEND_API_KEY || '',
      emailFrom: process.env.PLATFORM_AUTH_EMAIL_FROM || 'no-repiy@huizhi.yun',
      activationBaseUrl: process.env.PLATFORM_AUTH_ACTIVATION_BASE_URL || process.env.PLATFORM_SERVICE_URL || '',
      emailActivationTtlSeconds: Number(process.env.PLATFORM_AUTH_EMAIL_ACTIVATION_TTL_SECONDS || '86400'),
      googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      googleRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
      googleHostedDomain: process.env.GOOGLE_OAUTH_HOSTED_DOMAIN || '',
      googleAllowedEmails: process.env.GOOGLE_OAUTH_ALLOWED_EMAILS || '',
      googleAllowedDomains: process.env.GOOGLE_OAUTH_ALLOWED_DOMAINS || '',
      wecomCorpid: process.env.WECOM_CORPID || '',
      wecomCorpsecret: process.env.WECOM_CORPSECRET || '',
      wecomAgentid: process.env.WECOM_AGENTID || '',
      wecomRedirectUri: process.env.WECOM_OAUTH_REDIRECT_URI || '',
      wecomAllowedUserids: process.env.WECOM_OAUTH_ALLOWED_USERIDS || '',
      wecomAllowAll: process.env.WECOM_OAUTH_ALLOW_ALL || 'false'
    },
    observability: {
      apiUrl: process.env.HZY_OBSERVABILITY_API_URL || '',
      adminToken: process.env.HZY_OBSERVABILITY_ADMIN_TOKEN || ''
    },
    public: {
      appCode: 'platform',
      appName: pkg.name,
      deploymentProfile,
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云平台',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '/logo.svg',
      platformStage: process.env.NUXT_PUBLIC_PLATFORM_STAGE || 'greenfield',
      serviceUrl: process.env.PLATFORM_SERVICE_URL || '',
      authDevMockEnabled: process.env.NODE_ENV !== 'production' && process.env.PLATFORM_AUTH_DEV_MOCK !== 'false',
      googleAdminLoginEnabled: process.env.NUXT_PUBLIC_GOOGLE_ADMIN_LOGIN_ENABLED === 'true',
      wecomAdminLoginEnabled: process.env.NUXT_PUBLIC_WECOM_ADMIN_LOGIN_ENABLED === 'true'
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  compatibilityDate: '2026-01-19',

  nitro: {
    alias: {
      'safer-buffer': fileURLToPath(new URL('./server/shims/safer-buffer.ts', import.meta.url))
    },
    cloudflare: {
      deployConfig: false,
      nodeCompat: true
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
