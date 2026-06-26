import pkg from './package.json'

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
      name: process.env.DB_NAME || 'hzy_align',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10')
    },
    // Account API (huizhi-yun统一用户管理)
    hzy: {
      apiBaseUrl: process.env.HZY_ACCOUNT_API_URL,
      apiKey: process.env.HZY_ACCOUNT_API_KEY,
      apiSecret: process.env.HZY_ACCOUNT_API_SECRET,
      workflowApiUrl: process.env.HZY_WORKFLOW_API_URL || 'http://localhost:3009'
    },
    // 测试模式：通知重定向（留空则正常发送）
    notifyRedirectTo: process.env.NOTIFY_REDIRECT_TO || '',
    // 企业微信 OAuth（免登录）
    wecom: {
      corpid: process.env.WECOM_CORPID || '',
      corpsecret: process.env.WECOM_CORPSECRET || '',
      agentid: process.env.WECOM_AGENTID || ''
    },
    // Aliyun OSS配置
    oss: {
      bucketName: process.env.ALIYUN_OSS_BUCKET_NAME || '',
      endpoint: process.env.ALIYUN_OSS_ENDPOINT || '',
      accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
      region: process.env.ALIYUN_OSS_REGION || ''
    },
    public: {
      appCode: pkg.name,
      appName: pkg.name,
      appDisplayName: process.env.NUXT_PUBLIC_APP_DISPLAY_NAME || '汇智云协同',
      appLogo: process.env.NUXT_PUBLIC_APP_LOGO || '/logo.png',
      casEnable: process.env.CAS_ENABLE == 'true',
      // CAS 服务端基础地址（不含路径），例如：https://cas.wiztek.cn:8443
      casBaseUrl: process.env.CAS_BASE_URL || 'https://cas.wiztek.cn:8443',
      // 本应用对外可访问的基础地址（用于 CAS 回调 service 参数）。
      // 若留空，将在运行时回退为 window.location.origin（客户端）或请求 Host（服务端）。
      serviceUrl: process.env.CAS_SERVICE_URL || '',
      // 企业微信（客户端需要 corpid 和 agentid 构建 OAuth URL）
      wecomCorpid: process.env.WECOM_CORPID || '',
      wecomAgentid: process.env.WECOM_AGENTID || '',
      accountUrl: process.env.HZY_ACCOUNT_URL || process.env.HZY_ACCOUNT_API_URL || 'http://localhost:3000'
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
