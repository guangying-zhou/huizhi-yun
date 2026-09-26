import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from './tenantRuntimeClient'

export interface ConsoleIntegrationCredential {
  credentialName: string
  credentialVersionNo: number | null
  versionNo: number | null
  secretCode: string
  secretRef: string
  secretUsageType?: string | null
  status: string
}

export interface ConsoleIntegration {
  integrationCode: string
  integrationType: string
  integrationName: string
  category: string
  providerCode?: string | null
  baseUrl?: string | null
  config: Record<string, unknown>
  connectivityStatus: string
  lastCheckedAt?: string | null
  lastErrorMessage?: string | null
  status: string
  currentCredential: ConsoleIntegrationCredential | null
}

export interface IntegrationRuntimeConfig<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  integrationCode: string
  integrationType: string
  integrationName: string
  baseUrl: string
  config: TConfig
  secretRef: string | null
  secretVersionNo: number | null
}

export interface OssRuntimeConfig extends IntegrationRuntimeConfig<{
  bucketName?: string
  endpoint?: string
  region?: string
  [key: string]: unknown
}> {
  accessKeySecret: string
}

export interface AiProviderRuntimeConfig extends IntegrationRuntimeConfig<{
  model?: string
  defaultModel?: string
  [key: string]: unknown
}> {
  apiKey: string
}

export interface DingTalkRuntimeConfig extends IntegrationRuntimeConfig<{
  appId?: string
  appKey?: string
  clientId?: string
  oapiBaseUrl?: string
  [key: string]: unknown
}> {
  appId: string
  appSecret: string
}

type ConsoleApiResponse<T> = {
  code?: number
  data?: T
  message?: string
}

type IntegrationRuntimeOptions = {
  event?: H3Event | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    if (current !== undefined && current !== null && String(current).trim()) {
      return String(current).trim()
    }
  }

  return ''
}

function integrationRuntimeEvent(options: IntegrationRuntimeOptions) {
  const event = options.event || useEvent()
  if (!event) {
    throw createError({
      statusCode: 503,
      message: 'Tenant Runtime integration access requires a request-bound service identity'
    })
  }
  return event
}

async function fetchServiceIntegrationRuntime<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    scope: string
    event?: H3Event | null
  }
): Promise<T> {
  const event = integrationRuntimeEvent({ event: options.event })
  const runtime = await maybeCallTenantRuntime<ConsoleApiResponse<T>>(
    event,
    path,
    {
      appCode: 'console',
      scope: options.scope,
      capabilityFormat: 'console-integration',
      serviceTokenSourceBinding: 'service-client-policy',
      method: options.method || 'GET',
      body: options.body
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Tenant Runtime is required for integration access'
    })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({
      statusCode: 502,
      message: runtime.data.message || 'Tenant Runtime integration API returned an error'
    })
  }
  return runtime.data.data as T
}

export async function getIntegrationConfig<TConfig extends Record<string, unknown> = Record<string, unknown>>(
  integrationCode: string,
  options: IntegrationRuntimeOptions = {}
): Promise<ConsoleIntegration & { config: TConfig }> {
  const code = stringValue(integrationCode)
  if (!code) {
    throw createError({ statusCode: 400, message: 'integrationCode is required' })
  }

  return await fetchServiceIntegrationRuntime<ConsoleIntegration & { config: TConfig }>(
    `/v1/console/service/integrations/${encodeURIComponent(code)}`,
    {
      scope: 'integration_config:view',
      event: options.event
    }
  )
}

export async function resolveIntegrationSecret(input: {
  integrationCode: string
  purpose: string
}, options: IntegrationRuntimeOptions = {}) {
  const result = await fetchServiceIntegrationRuntime<{
    secretCode: string
    secretRef: string
    versionNo: number
    value: string
  }>(`/v1/console/service/integrations/${encodeURIComponent(input.integrationCode)}/resolve`, {
    method: 'POST',
    scope: 'credential_vault:resolve',
    body: {},
    event: options.event
  })

  return result.value
}

export async function getIntegrationRuntimeConfig<TConfig extends Record<string, unknown> = Record<string, unknown>>(
  integrationCode: string,
  options: IntegrationRuntimeOptions = {}
): Promise<IntegrationRuntimeConfig<TConfig>> {
  const integration = await getIntegrationConfig<TConfig>(integrationCode, options)
  return {
    integrationCode: integration.integrationCode,
    integrationType: integration.integrationType,
    integrationName: integration.integrationName,
    baseUrl: integration.baseUrl || '',
    config: integration.config,
    secretRef: integration.currentCredential?.secretRef || null,
    secretVersionNo: integration.currentCredential?.versionNo || null
  }
}

export async function getOssRuntimeConfig(integrationCode = 'oss.default', options: IntegrationRuntimeOptions = {}): Promise<OssRuntimeConfig> {
  const config = await getIntegrationRuntimeConfig<OssRuntimeConfig['config']>(integrationCode, options)
  const accessKeySecret = await resolveIntegrationSecret({
    integrationCode,
    purpose: 'oss_runtime'
  }, options)
  return {
    ...config,
    accessKeySecret
  }
}

export async function getAiProviderRuntimeConfig(integrationCode = 'ai.default'): Promise<AiProviderRuntimeConfig> {
  const config = await getIntegrationRuntimeConfig<AiProviderRuntimeConfig['config']>(integrationCode)
  const apiKey = await resolveIntegrationSecret({
    integrationCode,
    purpose: 'ai_provider_runtime'
  })
  return {
    ...config,
    apiKey
  }
}

export async function getDingTalkRuntimeConfig(integrationCode = 'dingtalk.default'): Promise<DingTalkRuntimeConfig> {
  const runtime = await getIntegrationRuntimeConfig<DingTalkRuntimeConfig['config']>(integrationCode)
  const appId = getConfigValue(runtime.config, ['appId', 'appKey', 'clientId'])
  if (!appId) {
    throw createError({
      statusCode: 409,
      message: `Integration ${integrationCode} is missing appId/appKey`
    })
  }

  const appSecret = await resolveIntegrationSecret({
    integrationCode,
    purpose: 'dingtalk_runtime'
  })
  return {
    ...runtime,
    appId,
    appSecret
  }
}
