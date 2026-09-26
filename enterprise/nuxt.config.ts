import { fileURLToPath } from 'node:url'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules, registerBusinessPages } from './composition/registry.mjs'
import { auxiliaryAreas, businessAreas } from './composition/business-areas.mjs'

const consoleUrl = process.env.HZY_CONSOLE_URL || ''
const pilot = process.env.HZY_ENTERPRISE_PILOT === 'true'
const authPrefix = pilot ? '/enterprise' : ''
const enterprisePublicOrigin = (process.env.HZY_DEPLOYMENT_PUBLIC_URL || '').replace(/\/+$/, '')
const enterpriseRedirectUri = process.env.HZY_ENTERPRISE_OIDC_REDIRECT_URI
  || (pilot && enterprisePublicOrigin ? `${enterprisePublicOrigin}/enterprise/api/auth/oidc-callback` : '')
  || (pilot ? 'https://hzy-test.huizhi.yun/enterprise/api/auth/oidc-callback' : '')
const enterpriseLogoutRedirectUri = process.env.HZY_ENTERPRISE_LOGOUT_REDIRECT_URI
  || (pilot && enterprisePublicOrigin ? `${enterprisePublicOrigin}/enterprise/login` : '')
  || (pilot ? 'https://hzy-test.huizhi.yun/enterprise/login' : '')
const appBasePath = '/'

function withAppBase(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${appBasePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

// Keep Host logo URLs on the app base path (and absolute/data URLs intact).
// Previously referenced without a definition, which broke Nuxt config reloads.
function resolveAppAsset(path: string, fallback: string) {
  const value = String(path || '').trim()
  if (!value) return withAppBase(fallback)
  if (/^(https?:)?\/\//.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value
  if (value.startsWith(appBasePath)) return value
  if (value.startsWith('/')) return withAppBase(value)
  return value
}

export default defineNuxtConfig({
  ...(process.env.HZY0_LOCAL_ENTERPRISE === 'true'
    ? { vite: { server: { allowedHosts: ['hzy0.isme.dev'], hmr: { protocol: 'wss' as const, clientPort: 443 } } } }
    : {}),
  extends: ['@hzy/foundation'],
  modules: ['@nuxt/ui', '@pinia/nuxt', '@vueuse/nuxt'],
  components: {
    dirs: [
      {
        path: fileURLToPath(new URL('../aims/layer/components', import.meta.url)),
        pattern: 'EnterpriseProjectProducts.vue', pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../assets/app/components/assets', import.meta.url)),
        pattern: '{SummaryMetricGrid,DigitalAssetCreateModal,DigitalAssetEditModal,DigitalAssetProductLinkModal,DigitalAssetDocumentLinkModal,IpAssetCreateModal,IpAssetEditModal,IpAssetProductLinkModal,IpAssetDocumentLinkModal}.vue',
        prefix: 'Assets', pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../codocs/app/components', import.meta.url)),
        pattern: '{FileTreeItem,MoveFolderModal,MoveFolderTreeNode,ProjectTreeSelector,RestoreDocumentModal}.vue',
        pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../codocs/app/components/document', import.meta.url)),
        pattern: '{ShareDocumentModal,TransferDocumentModal,VersionDiffModal}.vue',
        prefix: 'Document', pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../codocs/app/components/editor', import.meta.url)),
        pattern: '**/*.vue', prefix: 'Editor', pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../codocs/app/components/cabinet', import.meta.url)),
        pattern: 'CabinetPptxPreview.client.vue', pathPrefix: false
      },
      {
        path: fileURLToPath(new URL('../codocs/app/components/review', import.meta.url)),
        pattern: '{SealConfirmModal,SendConfirmModal,ReceiveConfirmModal,PublishRecordModal}.vue',
        prefix: 'Review', pathPrefix: false
      }
    ]
  },
  ssr: false,
  // The SPA loader is emitted in the initial HTML, before the large Dev module
  // graph is fetched. Nuxt removes it once the first page resolves.
  spaLoadingTemplate: './spa-loading-template.html',
  experimental: { spaLoadingTemplateLocation: 'body' },
  devtools: { enabled: false },
  sourcemap: { server: false, client: false },
  app: { baseURL: '/', ...(pilot ? { buildAssetsDir: '/enterprise/_nuxt/' } : {}), head: { htmlAttrs: { lang: 'zh-CN' } } },
  appConfig: {
    enterprise: {
      businessNavigation: buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas),
      objectWorkspaces: buildObjectWorkspaces(businessModules)
    }
  },
  css: ['~/assets/css/main.css'],
  hooks: {
    'vite:extendConfig'(config, { isClient }) {
      if (process.env.HZY0_LOCAL_ENTERPRISE !== 'true' || !isClient) return
      // Over Tunnel, the unbundled UI barrels create hundreds of serial module
      // requests. VueUse's module excludes these by default; select only these
      // client libraries after module configuration. Bundle the Vue runtime
      // family together, using Nuxt's existing aliases to keep one Vue instance;
      // application sources and virtual modules retain normal HMR.
      const dependencies = [
        'vue', '@vue/runtime-core', '@vue/runtime-dom', '@vue/reactivity', '@vue/shared',
        'reka-ui', '@vueuse/core', '@vueuse/shared', '@vue/devtools-kit',
        'pinia', 'tailwind-merge', 'tailwind-variants', '@iconify/vue',
        // Imported by composed Aims pages. Discovered at runtime they force a
        // re-optimize and full reload; a fresh browser can then mix module
        // versions and fail with "useHead() was called without provide context".
        'date-fns', 'date-fns/locale', 'marked'
      ]
      if (!config.optimizeDeps) return
      config.optimizeDeps.exclude = (config.optimizeDeps.exclude || []).filter(name => !dependencies.includes(name))
      config.optimizeDeps.include = [...new Set([...(config.optimizeDeps.include || []), ...dependencies])]
      config.plugins?.push({
        name: 'hzy0-compact-route-metadata',
        apply: 'serve',
        enforce: 'post',
        transform(code, id) {
          if (!/[?&]macro=true(?:&|$)/.test(id)) return
          // Nuxt extracts tiny route metadata but upstream Vue maps retain the
          // entire SFC. Every route eagerly imports this metadata. Drop only
          // those irrelevant maps; the actual page keeps its debugger and HMR.
          return { code, map: { version: 3, names: [], sources: [], mappings: '' } }
        }
      })
    },
    'pages:extend'(pages) {
      pages.push(...registerBusinessPages(pages, businessModules, fileURLToPath(new URL('./app/module-entry.vue', import.meta.url))))
    }
  },
  runtimeConfig: {
    verifiedPolicy: {
      enabled: process.env.HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED === 'true',
      issuer: process.env.HZY_ENTERPRISE_POLICY_ISSUER || '',
      kid: process.env.HZY_ENTERPRISE_POLICY_KEY_ID || '',
      publicKey: process.env.HZY_ENTERPRISE_POLICY_PUBLIC_KEY || '',
      environment: process.env.HZY_PLATFORM_ENVIRONMENT || '',
      // Accepts the 60-minute signed lease; test profiles set their own window.
      maxAgeMs: Number(process.env.HZY_ENTERPRISE_POLICY_MAX_AGE_MS || 3600000)
    },
    hzy: {
      authMode: 'console-oidc',
      legacyAuthBridge: false,
      ...(process.env.HZY0_LOCAL_ENTERPRISE === 'true' && process.env.HZY_WORKFLOW_API_URL
        ? { workflowApiUrl: process.env.HZY_WORKFLOW_API_URL }
        : {}),
      consoleRuntime: { consoleApiUrl: consoleUrl },
      consoleOidc: { clientId: 'enterprise', ...(pilot ? { redirectUri: enterpriseRedirectUri, logoutRedirectUri: enterpriseLogoutRedirectUri } : {}) },
      directory: { provider: 'console', consoleApiUrl: consoleUrl },
      integration: { consoleApiUrl: consoleUrl }
    },
    public: {
      hostWorkflowEnabled: process.env.HZY0_LOCAL_ENTERPRISE === 'true' && Boolean(process.env.HZY_WORKFLOW_API_URL),
      appLogo: resolveAppAsset(process.env.NUXT_PUBLIC_APP_LOGO || '', pilot ? '/enterprise/logo.svg' : '/logo.svg'),
      appCode: 'enterprise', appName: 'enterprise', appDisplayName: '汇智云',
      // Stage B: shared v2 documents co-edit through Collab (server checks the same switches).
      codocsCollaborationV2: process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true' && process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2 === 'true',
      collaborationUrl: process.env.NUXT_PUBLIC_COLLABORATION_URL || '/codocs/ws',
      // Shown as an outlined badge in the top bar outside production only.
      platformEnvironment: process.env.HZY_PLATFORM_ENVIRONMENT || '',
      // Composed at build time from each module's declared menu; every target is
      // verified against that module's registered pages.
      businessNavigation: buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas),
      objectWorkspaces: buildObjectWorkspaces(businessModules),
      // Legacy embedded editor consumers still require an explicit origin;
      // the Host's native full document route does not depend on it.
      codocsUrl: process.env.NUXT_PUBLIC_CODOCS_URL || process.env.HZY_CODOCS_ORIGIN || '',
      appBasePath: '/', authApiPrefix: authPrefix, enterpriseLoginPath: pilot ? '/enterprise/login' : '/login',
      // Mirrors the alias list declared by app/pages/login.vue so Foundation
      // recognizes every path that renders the login page.
      loginPaths: ['/login', '/aims/login', '/assets/login', '/enterprise/login'],
      consoleUrl, authMode: 'console-oidc', legacyAuthBridge: false,
      // Empty until INT-107 provides verified per-module deployment bindings.
      modules: { aims: { enabled: false }, assets: { enabled: false } }
    }
  },
  compatibilityDate: '2026-06-15',
  nitro: { externals: { inline: [fileURLToPath(new URL('./shared/', import.meta.url)), fileURLToPath(new URL('./composition/', import.meta.url))] }, typescript: { tsConfig: { compilerOptions: { allowImportingTsExtensions: true } } }, alias: {
    'safer-buffer': fileURLToPath(new URL('./server/shims/safer-buffer.ts', import.meta.url)),
    ...(process.env.HZY_CLOUDFLARE_BUILD === 'true'
      ? {
          'ali-oss': fileURLToPath(new URL('./server/shims/ali-oss.ts', import.meta.url)),
          'mammoth': fileURLToPath(new URL('../codocs/server/shims/mammoth.ts', import.meta.url))
        }
      : {})
  }, cloudflare: { deployConfig: false, nodeCompat: true }, experimental: { asyncContext: true } },
  typescript: { strict: true, tsConfig: { compilerOptions: { allowImportingTsExtensions: true } } }
})
