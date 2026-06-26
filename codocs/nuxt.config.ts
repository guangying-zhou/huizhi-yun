import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
  const baseURL = appBasePath
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${baseURL}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

function buildDefaultCollaborationUrl() {
  const configured = stringValue(process.env.NUXT_PUBLIC_COLLABORATION_URL)
  if (configured) return configured

  const publicUrl = stringValue(process.env.HZY_DEPLOYMENT_PUBLIC_URL).replace(/\/+$/, '')
  if (!publicUrl) return isCloudflareBuild || process.env.NODE_ENV === 'production' ? '' : 'ws://localhost:3021'

  try {
    const url = new URL(publicUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = withAppBase('/ws')
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return 'ws://localhost:3021'
  }
}

function resolvePublicHmrConfig() {
  const deploymentPublicUrl = stringValue(process.env.HZY_DEPLOYMENT_PUBLIC_URL)
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

const publicSansFonts = [
  { file: 'PublicSans-Thin.woff2', style: 'normal', weight: 100 },
  { file: 'PublicSans-ThinItalic.woff2', style: 'italic', weight: 100 },
  { file: 'PublicSans-ExtraLight.woff2', style: 'normal', weight: 200 },
  { file: 'PublicSans-ExtraLightItalic.woff2', style: 'italic', weight: 200 },
  { file: 'PublicSans-Light.woff2', style: 'normal', weight: 300 },
  { file: 'PublicSans-LightItalic.woff2', style: 'italic', weight: 300 },
  { file: 'PublicSans-Regular.woff2', style: 'normal', weight: 400 },
  { file: 'PublicSans-Italic.woff2', style: 'italic', weight: 400 },
  { file: 'PublicSans-Medium.woff2', style: 'normal', weight: 500 },
  { file: 'PublicSans-MediumItalic.woff2', style: 'italic', weight: 500 },
  { file: 'PublicSans-SemiBold.woff2', style: 'normal', weight: 600 },
  { file: 'PublicSans-SemiBoldItalic.woff2', style: 'italic', weight: 600 },
  { file: 'PublicSans-Bold.woff2', style: 'normal', weight: 700 },
  { file: 'PublicSans-BoldItalic.woff2', style: 'italic', weight: 700 },
  { file: 'PublicSans-ExtraBold.woff2', style: 'normal', weight: 800 },
  { file: 'PublicSans-ExtraBoldItalic.woff2', style: 'italic', weight: 800 },
  { file: 'PublicSans-Black.woff2', style: 'normal', weight: 900 },
  { file: 'PublicSans-BlackItalic.woff2', style: 'italic', weight: 900 }
]

function buildPublicSansFontFaces() {
  return publicSansFonts.map(font => `@font-face {
  font-family: 'Public Sans';
  font-style: ${font.style};
  font-weight: ${font.weight};
  font-display: swap;
  src: url('${withAppBase(`/fonts/${font.file}`)}') format('woff2');
}`).join('\n\n')
}

const configuredConsoleUrl = process.env.HZY_CONSOLE_URL || process.env.HZY_CONSOLE_API_URL || ''
const deploymentProfile = process.env.NUXT_PUBLIC_DEPLOYMENT_PROFILE || process.env.HZY_DEPLOYMENT_PROFILE || ''
const deploymentPublicUrl = process.env.NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || ''
const defaultConsoleUrl = configuredConsoleUrl || deploymentPublicUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
const appCode = process.env.HZY_APP_CODE || 'codocs'
const appBasePath = resolveAppBasePath(appCode)
const isCloudflareBuild = process.env.HZY_CLOUDFLARE_BUILD === 'true'
  || process.env.NITRO_PRESET === 'cloudflare_module'
  || process.env.NUXT_NITRO_PRESET === 'cloudflare_module'

const codocsRouteRules = {
  '/api/**': {
    cors: true
  },
  // 企业微信可信域名验证文件
  '/WW_verify_cLzQx20CTaflmPf7.txt': {
    proxy: '/api/wecom/verify'
  }
} as const

const routeRulesMatcherSource = `const routeRules = ${JSON.stringify(codocsRouteRules, null, 2)}

function matches(pattern, path) {
  if (pattern === path) return true
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(prefix + '/')
  }
  return false
}

export default function routeRulesMatcher(path = '') {
  const matched = []
  for (const [pattern, rules] of Object.entries(routeRules)) {
    if (matches(pattern, path)) matched.push(rules)
  }
  return Object.assign({}, ...matched)
}
`

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
      ],
      style: [
        {
          innerHTML: buildPublicSansFontFaces()
        }
      ]
    }
  },

  css: [
    '~/assets/css/main.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css'
  ],

  colorMode: {
    storageKey: 'hzy-color-mode'
  },

  ui: {
    fonts: false
    // FIXME: 'safelistColors' is not a valid option in @nuxt/ui v4.x.
    // If you need to safelist colors for dynamic classes, please use the Tailwind CSS configuration directly.
    // safelistColors: ['orange', 'amber', 'lime', 'emerald', 'teal', 'cyan', 'sky', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral', 'stone']
  },

  runtimeConfig: {
    fastapi: {
      baseUrl: process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000'
    },
    fetcher: {
      baseUrl: process.env.X_FETCHER_URL || 'http://localhost:8001'
    },
    // HZY runtime adapters
    hzy: {
      deploymentProfile,
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      dataAccessMode: process.env.HZY_CODOCS_DATA_ACCESS_MODE || process.env.HZY_DATA_ACCESS_MODE || 'tenant-runtime',
      tenantRuntime: {
        endpoint: process.env.HZY_CODOCS_TENANT_RUNTIME_URL || process.env.HZY_TENANT_RUNTIME_URL || process.env.HZY_CODOCS_DATA_RUNTIME_URL || process.env.HZY_DATA_RUNTIME_URL || '',
        token: process.env.HZY_CODOCS_TENANT_RUNTIME_TOKEN || process.env.HZY_TENANT_RUNTIME_TOKEN || process.env.HZY_CODOCS_DATA_RUNTIME_TOKEN || process.env.HZY_DATA_RUNTIME_TOKEN || '',
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
    collaborationAuthSecret: '',
    notifyRedirectTo: process.env.NOTIFY_REDIRECT_TO || '',
    // Slidev 渲染服务地址
    slidevServiceUrl: process.env.SLIDEV_SERVICE_URL || 'http://localhost:3040',
    // Aliyun OSS 运行时配置由 server/plugins/console-integrations.ts 从 Console integration/vault 填充。
    oss: {
      integrationCode: 'oss.default',
      provider: process.env.HZY_OBJECT_STORAGE_PROVIDER || process.env.OSS_PROVIDER || '',
      bucketName: '',
      endpoint: '',
      accessKeyId: '',
      accessKeySecret: '',
      region: '',
      bucketDomain: '',
      projectsBucketName: '',
      projectsEndpoint: '',
      projectsBucketDomain: '',
      imagesBucketName: '',
      imagesEndpoint: '',
      imagesBucketDomain: '',
      forcePathStyle: process.env.HZY_OBJECT_STORAGE_FORCE_PATH_STYLE || process.env.OSS_FORCE_PATH_STYLE || '',
      recycleDays: 30
    },
    public: {
      appCode,
      gitlabBaseUrl: 'http://gitlab.wiztek.cn/',
      collaborationUrl: buildDefaultCollaborationUrl(),
      appName: packageMeta.name || 'codocs',
      appVersion: packageMeta.version || '0.0.0',
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云文档',
      appIcon: process.env.NUXT_PUBLIC_APP_ICON || 'i-lucide-files',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || withAppBase('/logo.png'),
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || process.env.HZY_DEPLOYMENT_PUBLIC_URL || '',
      deploymentProfile,
      deploymentPublicUrl,
      appBasePath,
      appHomeUrl: process.env.HZY_APP_HOME_URL || process.env.NUXT_PUBLIC_APP_HOME_URL || '',
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      consoleUrl: defaultConsoleUrl,
      accountUrl: defaultConsoleUrl,
      recycleDays: 30
    }
  },
  buildDir: '.nuxt',

  routeRules: codocsRouteRules,

  experimental: {
    appManifest: false,
    payloadExtraction: false
  },

  compatibilityDate: '2026-01-19',

  nitro: {
    alias: {
      'safer-buffer': join(import.meta.dirname, 'server/shims/safer-buffer.ts'),
      ...(isCloudflareBuild
        ? {
            'ali-oss': join(import.meta.dirname, 'server/shims/ali-oss.ts'),
            'mammoth': join(import.meta.dirname, 'server/shims/mammoth.ts')
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
    // 允许 Vite 自动产生基础配置，我们在下面的 hook 中进行精确覆盖
    build: {
      sourcemap: false
    },
    // 强制 yjs 及相关包解析到同一份实例，避免生产构建中 Yjs 被重复打包
    // https://github.com/yjs/yjs/issues/438
    // 另外强制 prosemirror 相关包去重，避免生产构建中出现多份 DecorationSet 类
    // 导致 "Cannot read properties of undefined (reading 'localsInner')" 错误
    // （发生于鼠标 hover 到表格列分隔线触发 columnResizing 装饰器时）
    resolve: {
      dedupe: [
        'yjs', 'y-prosemirror', 'y-protocols', 'y-websocket', 'lib0',
        'prosemirror-view',
        'prosemirror-state',
        'prosemirror-model',
        'prosemirror-transform',
        'prosemirror-tables',
        'prosemirror-keymap',
        'prosemirror-commands',
        'prosemirror-history',
        'prosemirror-inputrules',
        'prosemirror-schema-list',
        'prosemirror-gapcursor',
        'prosemirror-dropcursor'
      ]
    }
  },

  // 确保 HMR 配置被正确应用并处理可能出现的端口冲突
  hooks: {
    async 'build:before'() {
      const routeRulesFile = join(import.meta.dirname, '.nuxt', 'route-rules.mjs')
      await mkdir(dirname(routeRulesFile), { recursive: true })
      await writeFile(routeRulesFile, routeRulesMatcherSource, 'utf8')
    },
    'vite:extendConfig'(config, { isClient, isServer }) {
      if (process.env.NODE_ENV === 'production') {
        return
      }

      const hmrPort
        = Number(process.env.NUXT_VITE_HMR_PORT || process.env.VITE_HMR_PORT)
          || 24679

      // 避免直接赋值 config.server 以防止 "read-only property" 错误
      // 确保 config.server 对象存在
      if (!config.server) {
        try {
          (config as Record<string, unknown>).server = {}
        } catch {
          // 如果无法修改，说明这是一个受限环境，跳过
          return
        }
      }

      if (config.server) {
        if (isServer) {
          // SSR环境：完全禁用HMR以避免端口冲突
          config.server.hmr = false
          console.log('✅ Disabled SSR HMR')
        } else if (isClient) {
          const publicHmrConfig = resolvePublicHmrConfig()
          config.server.hmr = publicHmrConfig || {
            protocol: 'ws',
            host: 'localhost',
            port: hmrPort,
            clientPort: hmrPort
          }
          console.log('✅ Set Client HMR:', publicHmrConfig || hmrPort)
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

  // 禁用远程字体解析，Foundation 已通过 ui.fonts: false 统一处理
})
