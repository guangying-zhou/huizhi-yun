export interface RedisConfig {
  disabled: boolean
  host: string
  port: number
  password?: string
  connectTimeout: number
}

export interface OssConfig {
  integrationCode?: string
  bucketName: string
  endpoint: string
  accessKeyId: string
  accessKeySecret: string
  region: string
  bucketDomain?: string
  projectsBucketName?: string
  projectsEndpoint?: string
  projectsBucketDomain?: string
  imagesBucketName?: string
  imagesEndpoint?: string
  imagesBucketDomain?: string
  recycleDays?: number
}

export interface CodocsRuntimeConfig {
  endpoint: string
  token?: string
}

export interface CollabConfig {
  appCode: string
  provider: string
  runtimeMode: 'standalone' | 'embedded'
  port: number
  address: string
  basePath: string
  stopOnSignals: boolean
  codocsRuntime: CodocsRuntimeConfig
  redis: RedisConfig
  oss: OssConfig
}

export interface LoadCollabConfigOptions {
  runtimeMode?: CollabConfig['runtimeMode']
  stopOnSignals?: boolean
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function intValue(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = stringValue(process.env[key])
    if (value) return value
  }
  return ''
}

function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value) || '/collab/'
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function readRuntimeMode(value: unknown, fallback: CollabConfig['runtimeMode']): CollabConfig['runtimeMode'] {
  const normalized = stringValue(value)
  return normalized === 'embedded' || normalized === 'standalone' ? normalized : fallback
}

export function loadCollabConfig(options: LoadCollabConfigOptions = {}): CollabConfig {
  const runtimeMode = options.runtimeMode || readRuntimeMode(
    process.env.COLLAB_RUNTIME_MODE || process.env.CONSOLE_COLLAB_MODE || process.env.HZY_COLLAB_MODE,
    'standalone'
  )
  const defaultStopOnSignals = runtimeMode === 'standalone'

  return {
    appCode: stringValue(process.env.COLLAB_APP_CODE) || (runtimeMode === 'standalone' ? stringValue(process.env.HZY_APP_CODE) : '') || 'collab',
    provider: stringValue(process.env.COLLAB_PROVIDER) || 'hocuspocus',
    runtimeMode,
    port: intValue(process.env.COLLAB_PORT, 3021),
    address: stringValue(process.env.COLLAB_ADDRESS) || '127.0.0.1',
    basePath: normalizeBasePath(process.env.COLLAB_PUBLIC_BASE_PATH),
    stopOnSignals: options.stopOnSignals ?? boolValue(process.env.COLLAB_STOP_ON_SIGNALS, defaultStopOnSignals),
    codocsRuntime: {
      endpoint: envValue(
        'COLLAB_CODOCS_RUNTIME_URL',
        'HZY_CODOCS_TENANT_RUNTIME_URL',
        'HZY_TENANT_RUNTIME_URL',
        'HZY_CODOCS_DATA_RUNTIME_URL',
        'HZY_DATA_RUNTIME_URL'
      ),
      token: envValue(
        'COLLAB_CODOCS_RUNTIME_TOKEN',
        'HZY_CODOCS_TENANT_RUNTIME_TOKEN',
        'HZY_TENANT_RUNTIME_TOKEN',
        'HZY_CODOCS_DATA_RUNTIME_TOKEN',
        'HZY_DATA_RUNTIME_TOKEN'
      ) || undefined
    },
    redis: {
      disabled: boolValue(process.env.COLLAB_REDIS_DISABLED ?? process.env.REDIS_DISABLED, false),
      host: stringValue(process.env.COLLAB_REDIS_HOST) || stringValue(process.env.REDIS_HOST) || '127.0.0.1',
      port: intValue(process.env.COLLAB_REDIS_PORT || process.env.REDIS_PORT, 6379),
      password: stringValue(process.env.COLLAB_REDIS_PASSWORD) || stringValue(process.env.REDIS_PASSWORD) || undefined,
      connectTimeout: intValue(process.env.COLLAB_REDIS_CONNECT_TIMEOUT || process.env.REDIS_CONNECT_TIMEOUT, 3000)
    },
    oss: {
      integrationCode: envValue('CONSOLE_COLLAB_OSS_INTEGRATION_CODE', 'COLLAB_OSS_INTEGRATION_CODE', 'HZY_OSS_INTEGRATION_CODE') || 'oss.default',
      bucketName: envValue('COLLAB_OSS_BUCKET_NAME', 'ALIYUN_OSS_BUCKET_NAME'),
      endpoint: envValue('COLLAB_OSS_ENDPOINT', 'ALIYUN_OSS_ENDPOINT'),
      accessKeyId: envValue('COLLAB_OSS_ACCESS_KEY_ID', 'ALIYUN_OSS_ACCESS_KEY_ID'),
      accessKeySecret: envValue('COLLAB_OSS_ACCESS_KEY_SECRET', 'ALIYUN_OSS_ACCESS_KEY_SECRET'),
      region: envValue('COLLAB_OSS_REGION', 'ALIYUN_OSS_REGION'),
      bucketDomain: envValue('COLLAB_OSS_BUCKET_DOMAIN', 'ALIYUN_OSS_BUCKET_DOMAIN'),
      projectsBucketName: envValue('COLLAB_OSS_PROJECTS_BUCKET_NAME', 'ALIYUN_OSS_PROJECTS_BUCKET_NAME'),
      projectsEndpoint: envValue('COLLAB_OSS_PROJECTS_ENDPOINT', 'ALIYUN_OSS_PROJECTS_ENDPOINT'),
      projectsBucketDomain: envValue('COLLAB_OSS_PROJECTS_BUCKET_DOMAIN', 'ALIYUN_OSS_PROJECTS_BUCKET_DOMAIN'),
      imagesBucketName: envValue('COLLAB_OSS_IMAGES_BUCKET_NAME', 'ALIYUN_OSS_IMAGES_BUCKET_NAME'),
      imagesEndpoint: envValue('COLLAB_OSS_IMAGES_ENDPOINT', 'ALIYUN_OSS_IMAGES_ENDPOINT'),
      imagesBucketDomain: envValue('COLLAB_OSS_IMAGES_BUCKET_DOMAIN', 'ALIYUN_OSS_IMAGES_BUCKET_DOMAIN'),
      recycleDays: intValue(process.env.COLLAB_OSS_RECYCLE_DAYS || process.env.ALIYUN_OSS_RECYCLE_DAYS, 30)
    }
  }
}
