import { createError } from 'h3'
import type { H3Event } from 'h3'
import { getOssRuntimeConfig } from './integrationConfig'
import { createAliOssCompatibleClient } from './objectStorage'

type OssIntegrationOptions = {
  event?: H3Event | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && stringValue(value)) {
      return stringValue(value)
    }
  }
  return ''
}

export async function getOssIntegrationConfig(integrationCode = 'oss.default', options: OssIntegrationOptions = {}) {
  const runtime = await getOssRuntimeConfig(integrationCode, { event: options.event })
  const accessKeyId = configValue(runtime.config, ['accessKeyId'])
  const bucket = configValue(runtime.config, ['bucketName', 'bucket'])
  const endpoint = configValue(runtime.config, ['endpoint']) || runtime.baseUrl
  const region = configValue(runtime.config, ['region'])
  const bucketDomain = configValue(runtime.config, ['bucketDomain'])

  if (!accessKeyId || !bucket || !endpoint) {
    throw createError({
      statusCode: 409,
      message: `Integration ${integrationCode} is missing accessKeyId, bucketName or endpoint`
    })
  }

  return {
    integrationCode: runtime.integrationCode,
    accessKeyId,
    accessKeySecret: runtime.accessKeySecret,
    bucket,
    endpoint,
    region,
    bucketDomain,
    config: runtime.config,
    secretVersionNo: runtime.secretVersionNo
  }
}

export async function getOssObjectStorageClient(integrationCode = 'oss.default', options: OssIntegrationOptions = {}) {
  const config = await getOssIntegrationConfig(integrationCode, options)
  return createAliOssCompatibleClient({
    provider: configValue(config.config, ['provider', 'objectStorageProvider', 'storageProvider']),
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    bucketDomain: config.bucketDomain,
    forcePathStyle: configValue(config.config, ['forcePathStyle', 'pathStyle'])
  })
}
