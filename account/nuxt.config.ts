// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['@hzy/foundation'],

  modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt'],

  ssr: false,

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
    disableTransition: true,
    storageKey: 'hzy-color-mode'
  },

  ui: {
    fonts: false
    // FIXME: 'safelistColors' is not a valid option in @nuxt/ui v4.x.
    // If you need to safelist colors for dynamic classes, please use the Tailwind CSS configuration directly.
    // safelistColors: ['orange', 'amber', 'lime', 'emerald', 'teal', 'cyan', 'sky', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral', 'stone']
  },

  runtimeConfig: {
    db: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'Wiztek@1902',
      name: process.env.DB_NAME || 'hzy_account',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || '10')
    },
    ingestionService: {
      baseUrl: process.env.INGESTION_SERVICE_BASE_URL || 'http://127.0.0.1:8090',
      apiKey: process.env.INGESTION_SERVICE_API_KEY || '',
      svnBasePath: process.env.SVN_BASE_PATH || '/svn',
      gitlabBaseUrl: process.env.GITLAB_BASE_URL || 'http://gitlab.huifangzx.com',
      gitlabApiToken: process.env.GITLAB_API_TOKEN || process.env.GITLAB_BOT_TOKEN || ''
    },
    fastapi: {
      baseUrl: process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000'
    },
    ldap: {
      host: process.env.LDAP_HOST || 'ldap.wiztek.cn',
      port: Number(process.env.LDAP_PORT || '636'),
      bindDN: process.env.LDAP_BIND_DN || 'cn=Manager,dc=wiztek,dc=cn',
      bindPassword: process.env.LDAP_BIND_PASSWORD || 'Wiztek@1902',
      baseDN: process.env.LDAP_BASE_DN || 'dc=wiztek,dc=cn',
      userBase: process.env.LDAP_USER_BASE || 'ou=People,dc=wiztek,dc=cn',
      useTLS: process.env.LDAP_USE_TLS !== 'false'
    },
    // Aliyun OSS配置
    oss: {
      bucketName: process.env.ALIYUN_OSS_BUCKET_NAME || '',
      endpoint: process.env.ALIYUN_OSS_ENDPOINT || '',
      accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
      region: process.env.ALIYUN_OSS_REGION || ''
    },
    // Aliyun OSS图片配置（用于存储应用图标等图片资源，未配置时回退到主OSS）
    ossImages: {
      bucketName: process.env.ALIYUN_OSS_IMAGES_BUCKET_NAME || process.env.ALIYUN_OSS_BUCKET_NAME || '',
      bucketDomain: process.env.ALIYUN_OSS_IMAGES_BUCKET_DOMAIN || '',
      endpoint: process.env.ALIYUN_OSS_IMAGES_ENDPOINT || process.env.ALIYUN_OSS_ENDPOINT || '',
      accessKeyId: process.env.ALIYUN_OSS_IMAGES_ACCESS_KEY_ID || process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_OSS_IMAGES_ACCESS_KEY_SECRET || process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
      region: process.env.ALIYUN_OSS_IMAGES_REGION || process.env.ALIYUN_OSS_REGION || ''
    },
    // 企业微信配置
    wecom: {
      corpId: process.env.WECOM_CORPID || '',
      corpSecret: process.env.WECOM_CORPSECRET || '',
      agentId: process.env.WECOM_AGENTID || '',
      contactSecret: process.env.WECOM_CONTACT_SECRET || ''
    },
    // 钉钉配置
    dingtalk: {
      appId: process.env.DINGTALK_APP_ID || '',
      appSecret: process.env.DINGTALK_APP_SECRET || ''
    },
    // AI 网关配置（通义千问默认值，可通过数据库 ai_providers 表覆盖）
    ai: {
      enabled: process.env.AI_ENABLED !== 'false',
      defaultApiKey: process.env.AI_API_KEY || '',
      defaultBaseUrl: process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || '60000')
    },
    // 公司邮箱域名
    companyDomain: process.env.COMPANY_DOMAIN || 'wiztek.cn',
    public: {
      appCode: 'account',
      appName: 'account',
      appDisplayName: '汇智云·账号',
      appLogo: '/logo.png',
      wecomEnabled: Boolean(
        process.env.WECOM_CORPID
        && process.env.WECOM_AGENTID
        && process.env.WECOM_CORPSECRET
      ),
      casEnable: process.env.CAS_ENABLE == 'true',
      // CAS 服务端基础地址（不含路径），例如：https://cas.wiztek.cn:8443
      casBaseUrl: process.env.CAS_BASE_URL || 'https://cas.wiztek.cn:8443',
      // 本应用对外可访问的基础地址（用于 CAS 回调 service 参数）。
      // 若留空，将在运行时回退为 window.location.origin（客户端）或请求 Host（服务端）。
      serviceUrl: process.env.CAS_SERVICE_URL || '',
      // 仅暴露"是否配置了 GitLab Token"和 GitLab 基础地址，避免在浏览器泄露密钥
      ingestionDefaults: {
        gitlabBaseUrl: process.env.GITLAB_BASE_URL || 'http://gitlab.huifangzx.com',
        hasGitlabToken: Boolean(process.env.GITLAB_API_TOKEN)
      }
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    },
    '/_openapi.json': {
      redirect: '/openapi.json'
    },
    '/_scalar': {
      redirect: '/scalar'
    },
    '/_swagger': {
      redirect: '/swagger'
    },
    '/_nitro/openapi.json': {
      redirect: '/openapi.json'
    },
    '/_nitro/scalar': {
      redirect: '/scalar'
    },
    '/_nitro/swagger': {
      redirect: '/swagger'
    }
  },

  compatibilityDate: '2024-07-11',

  nitro: {
    experimental: {
      openAPI: true
    },
    openAPI: {
      route: '/_nitro/__openapi.json',
      meta: {
        title: '汇智云 Account API',
        description: '统一身份与访问管理平台接口文档，涵盖用户、部门、角色、权限、应用管理等模块。',
        version: '1.0.0'
      },
      ui: {
        scalar: {
          route: '/_nitro/__scalar'
        },
        swagger: {
          route: '/_nitro/__swagger'
        }
      }
    }
  },

  vite: {
    optimizeDeps: {
      include: [
        'date-fns',
        'date-fns/locale',
        'lcn'
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
  },

  // @ts-expect-error fonts: false 禁用 @nuxt/fonts（由 @nuxt/ui 引入）
  fonts: false
})
