import { createError } from 'h3'
import type { OssConfig } from 'collab'
import { getIntegration } from '~~/server/utils/integrations'
import { resolveVaultSecret } from '~~/server/utils/vault'

export interface ResolveConsoleOssRuntimeOptions {
  integrationCode?: string
  actorId?: string
  purpose?: string
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

function numberConfigValue(config: Record<string, unknown>, key: string, fallback: number) {
  const parsed = Number(config[key])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function endpointForRuntime(value: string) {
  return value.replace(/^https?:\/\//i, '')
}

export async function resolveConsoleOssRuntimeConfig(options: ResolveConsoleOssRuntimeOptions = {}): Promise<OssConfig> {
  const integrationCode = stringValue(options.integrationCode) || 'oss.default'
  const integration = await getIntegration(integrationCode)

  if (!integration || integration.status !== 'active' || integration.integrationType !== 'oss') {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_INTEGRATION_MISSING',
      message: `OSS integration ${integrationCode} is not active`
    })
  }

  const credential = integration.currentCredential
  if (!credential?.secretRef && !credential?.secretCode) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_CREDENTIAL_MISSING',
      message: `OSS integration ${integrationCode} has no active credential`
    })
  }

  const config = integration.config || {}
  const accessKeyId = configValue(config, ['accessKeyId'])
  const bucketName = configValue(config, ['bucketName', 'bucket'])
  const endpoint = configValue(config, ['endpoint']) || stringValue(integration.baseUrl)
  const region = configValue(config, ['region'])
  const bucketDomain = configValue(config, ['bucketDomain'])

  if (!accessKeyId || !bucketName || !endpoint) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_INTEGRATION_INCOMPLETE',
      message: `OSS integration ${integrationCode} requires accessKeyId, bucketName and endpoint`
    })
  }

  const secret = await resolveVaultSecret({
    secretRef: credential.secretRef || undefined,
    secretCode: credential.secretRef ? undefined : credential.secretCode,
    actor: {
      actorType: 'system',
      actorId: stringValue(options.actorId) || 'console:collab-runtime',
      appCode: 'console'
    },
    purpose: stringValue(options.purpose) || `console_oss_runtime:${integrationCode}`
  })

  return {
    integrationCode,
    bucketName,
    endpoint: endpointForRuntime(endpoint),
    accessKeyId,
    accessKeySecret: secret.value,
    region,
    bucketDomain,
    projectsBucketName: configValue(config, ['projectsBucketName', 'projectsBucket']) || bucketName,
    projectsEndpoint: endpointForRuntime(configValue(config, ['projectsEndpoint']) || endpoint),
    projectsBucketDomain: configValue(config, ['projectsBucketDomain']) || bucketDomain,
    imagesBucketName: configValue(config, ['imagesBucketName', 'imagesBucket']) || bucketName,
    imagesEndpoint: endpointForRuntime(configValue(config, ['imagesEndpoint']) || endpoint),
    imagesBucketDomain: configValue(config, ['imagesBucketDomain']) || bucketDomain,
    recycleDays: numberConfigValue(config, 'recycleDays', 30)
  }
}
