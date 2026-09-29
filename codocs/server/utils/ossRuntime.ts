import type { H3Event } from 'h3'

type OssRuntimeConfig = Record<string, unknown>

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function endpointForRuntime(value: string) {
  return value.replace(/^https?:\/\//i, '')
}

declare global {

  var __codocsOssRuntimeConfig: OssRuntimeConfig | undefined
}

export function setCodocsOssRuntimeConfig(config: OssRuntimeConfig) {
  globalThis.__codocsOssRuntimeConfig = {
    ...(globalThis.__codocsOssRuntimeConfig || {}),
    ...config
  }
}

export function getCodocsOssRuntimeConfig(fallback: OssRuntimeConfig = {}) {
  return {
    ...fallback,
    ...(globalThis.__codocsOssRuntimeConfig || {})
  }
}

export async function loadCodocsOssRuntimeConfigFromConsole(integrationCode = 'oss.default', event?: H3Event | null) {
  const { getOssIntegrationConfig } = await import('@hzy/foundation/server/utils/ossIntegration')
  const config = useRuntimeConfig() as unknown as {
    oss?: Record<string, unknown>
  }
  const runtime = await getOssIntegrationConfig(integrationCode, { event })
  const runtimeConfig = runtime.config || {}
  const endpoint = endpointForRuntime(runtime.endpoint)
  const bucketDomain = stringValue(runtime.bucketDomain || runtimeConfig.bucketDomain)
  const projectsEndpoint = endpointForRuntime(stringValue(runtimeConfig.projectsEndpoint) || runtime.endpoint)
  const imagesEndpoint = endpointForRuntime(stringValue(runtimeConfig.imagesEndpoint) || runtime.endpoint)
  const forcePathStyle = runtimeConfig.forcePathStyle ?? config.oss?.forcePathStyle

  const resolved = {
    provider: stringValue(runtimeConfig.provider) || stringValue(config.oss?.provider),
    bucketName: runtime.bucket,
    endpoint,
    accessKeyId: runtime.accessKeyId,
    accessKeySecret: runtime.accessKeySecret,
    region: runtime.region || '',
    bucketDomain,
    projectsBucketName: stringValue(runtimeConfig.projectsBucketName) || runtime.bucket,
    projectsEndpoint,
    projectsBucketDomain: stringValue(runtimeConfig.projectsBucketDomain) || bucketDomain,
    imagesBucketName: stringValue(runtimeConfig.imagesBucketName) || runtime.bucket,
    imagesEndpoint,
    imagesBucketDomain: stringValue(runtimeConfig.imagesBucketDomain),
    forcePathStyle: typeof forcePathStyle === 'boolean' || typeof forcePathStyle === 'string' ? forcePathStyle : undefined,
    recycleDays: Number(runtimeConfig.recycleDays || config.oss?.recycleDays || 30)
  }

  // Request-bound configuration must not leak into another tenant's request
  // through a process global. Legacy startup callers retain their old cache.
  if (!event) setCodocsOssRuntimeConfig(resolved)
  return resolved
}
