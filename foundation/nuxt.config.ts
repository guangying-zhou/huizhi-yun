// Foundation Layer - 汇智云平台基础层
// 提供共享的 composables、组件、中间件、Store、类型定义
function splitEnvList(value: unknown) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeAllowedHost(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname
    }
  } catch {
    return ''
  }

  return raw
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

const viteAllowedHosts = Array.from(new Set(
  splitEnvList(process.env.NUXT_VITE_ALLOWED_HOSTS || process.env.VITE_ALLOWED_HOSTS)
    .map(normalizeAllowedHost)
    .filter(Boolean)
))

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  colorMode: {
    storageKey: 'hzy-color-mode'
  },

  // 禁用远程字体解析（各模块统一使用本地字体）
  ui: {
    fonts: false
  },

  runtimeConfig: {
    public: {
      deploymentProfile: process.env.HZY_DEPLOYMENT_PROFILE || process.env.DEPLOYMENT_PROFILE || '',
      authMode: process.env.HZY_AUTH_MODE || '',
      legacyAuthBridge: process.env.HZY_LEGACY_AUTH_BRIDGE === 'true',
      deploymentPublicUrl: process.env.HZY_DEPLOYMENT_PUBLIC_URL || '',
      appBasePath: process.env.HZY_APP_BASE_PATH || process.env.NUXT_APP_BASE_URL || '/',
      appHomeUrl: process.env.HZY_APP_HOME_URL || process.env.NUXT_PUBLIC_APP_HOME_URL || '',
      rum: {
        enabled: process.env.NUXT_PUBLIC_RUM_ENABLED || 'true',
        endpoint: process.env.NUXT_PUBLIC_RUM_ENDPOINT || '/api/rum',
        sampleRate: process.env.NUXT_PUBLIC_RUM_SAMPLE_RATE || '0.05'
      }
    }
  },

  vite: {
    ...(viteAllowedHosts.length > 0 ? { server: { allowedHosts: viteAllowedHosts } } : {}),
    optimizeDeps: {
      include: [
        'date-fns',
        'date-fns/locale'
      ]
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
