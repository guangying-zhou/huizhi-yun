import { fileURLToPath } from 'node:url'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules, registerBusinessPages } from './composition/registry.mjs'
import { auxiliaryAreas, businessAreas } from './composition/business-areas.mjs'

const consoleUrl = process.env.HZY_CONSOLE_URL || ''
const pilot = process.env.HZY_ENTERPRISE_PILOT === 'true'
const authPrefix = pilot ? '/enterprise' : ''
export default defineNuxtConfig({
  extends: ['@hzy/foundation'],
  modules: ['@nuxt/ui', '@pinia/nuxt', '@vueuse/nuxt'],
  ssr: false,
  devtools: { enabled: false },
  sourcemap: { server: false, client: false },
  app: { baseURL: '/', ...(pilot ? { buildAssetsDir: '/enterprise/_nuxt/' } : {}), head: { htmlAttrs: { lang: 'zh-CN' } } },
  css: ['~/assets/css/main.css'],
  hooks: {
    'pages:extend'(pages) {
      pages.push(...registerBusinessPages(pages, businessModules, fileURLToPath(new URL('./app/module-entry.vue', import.meta.url))))
    }
  },
  runtimeConfig: {
    hzy: {
      authMode: 'console-oidc',
      legacyAuthBridge: false,
      consoleRuntime: { consoleApiUrl: consoleUrl },
      consoleOidc: { clientId: 'enterprise', ...(pilot ? { redirectUri: 'https://hzy-test.huizhi.yun/enterprise/api/auth/oidc-callback', logoutRedirectUri: 'https://hzy-test.huizhi.yun/enterprise/login' } : {}) },
      directory: { provider: 'console', consoleApiUrl: consoleUrl },
      integration: { consoleApiUrl: consoleUrl }
    },
    public: {
      appCode: 'enterprise', appName: 'enterprise', appDisplayName: '汇智云',
      // Shown as an outlined badge in the top bar outside production only.
      platformEnvironment: process.env.HZY_PLATFORM_ENVIRONMENT || '',
      // Composed at build time from each module's declared menu; every target is
      // verified against that module's registered pages.
      businessNavigation: buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas),
      objectWorkspaces: buildObjectWorkspaces(businessModules),
      appBasePath: '/', authApiPrefix: authPrefix, enterpriseLoginPath: pilot ? '/enterprise/login' : '/login', consoleUrl, authMode: 'console-oidc', legacyAuthBridge: false,
      // Empty until INT-107 provides verified per-module deployment bindings.
      modules: { aims: { enabled: false }, assets: { enabled: false } }
    }
  },
  compatibilityDate: '2026-06-15',
  nitro: { typescript: { tsConfig: { compilerOptions: { allowImportingTsExtensions: true } } }, alias: {
    'safer-buffer': fileURLToPath(new URL('./server/shims/safer-buffer.ts', import.meta.url)),
    ...(process.env.HZY_CLOUDFLARE_BUILD === 'true' ? { 'ali-oss': fileURLToPath(new URL('./server/shims/ali-oss.ts', import.meta.url)) } : {})
  }, cloudflare: { deployConfig: false, nodeCompat: true }, experimental: { asyncContext: true } },
  typescript: { strict: true, tsConfig: { compilerOptions: { allowImportingTsExtensions: true } } }
})
