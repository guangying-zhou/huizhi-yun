import { createError, getHeader, type H3Event } from 'h3'
import { getConsoleRuntimeConfig, resolveConsoleRuntimeBaseUrl } from './consoleRuntime'
import { requestServiceAccessToken } from './serviceOidc'

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

export interface GitLabRuntimeConfig extends IntegrationRuntimeConfig<{
  groupPath?: string
  defaultBranch?: string
  [key: string]: unknown
}> {
  token: string
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

export interface WecomRuntimeConfig extends IntegrationRuntimeConfig<{
  corpid?: string
  corpId?: string
  agentid?: string
  agentId?: string
  [key: string]: unknown
}> {
  corpid: string
  agentid: string
  corpsecret: string
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

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function tenantGatewayRequestHeaders(event?: H3Event | null) {
  if (!event) return {}

  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-app-code',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  return headers
}

export function getConsoleIntegrationBaseUrl(options: IntegrationRuntimeOptions = {}) {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const configured = resolveConsoleRuntimeBaseUrl(config, options.event) || getConfigValue(config, [
    'hzy.integration.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.consoleApiUrl'
  ]) || process.env.HZY_CONSOLE_API_URL || process.env.HZY_CONSOLE_URL || getConfigValue(config, [
    'public.consoleUrl'
  ]) || ''

  if (!configured) {
    throw createError({
      statusCode: 503,
      message: 'Console API URL is not configured'
    })
  }
  return normalizeBaseUrl(configured)
}

async function resolveConsoleIntegrationBaseUrl(options: IntegrationRuntimeOptions = {}) {
  const runtime = await getConsoleRuntimeConfig(options.event ? { event: options.event } : undefined).catch(() => null)
  return normalizeBaseUrl(runtime?.console.baseUrl || getConsoleIntegrationBaseUrl(options))
}

function fetchStatusCode(error: unknown) {
  const candidate = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.statusCode || candidate?.response?.status || 0)
}

async function fetchConsoleIntegrationApi<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown> | null
    audience: string
    scope: string
    event?: H3Event | null
  }
): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseUrl = await resolveConsoleIntegrationBaseUrl({ event: options.event })

  const requestWithToken = async (forceRefresh: boolean) => {
    const token = await requestServiceAccessToken({
      audience: options.audience,
      scope: options.scope,
      forceRefresh,
      event: options.event
    })
    return await $fetch<ConsoleApiResponse<T>>(`${baseUrl}${normalizedPath}`, {
      method: options.method || 'GET',
      headers: {
        ...tenantGatewayRequestHeaders(options.event),
        Authorization: `Bearer ${token}`
      },
      body: options.body,
      timeout: 10000
    })
  }

  let response: ConsoleApiResponse<T>
  try {
    response = await requestWithToken(false)
  } catch (error) {
    if (fetchStatusCode(error) !== 401) {
      throw error
    }
    response = await requestWithToken(true)
  }

  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Console integration API returned an error'
    })
  }

  return response.data as T
}

export async function getIntegrationConfig<TConfig extends Record<string, unknown> = Record<string, unknown>>(
  integrationCode: string,
  options: IntegrationRuntimeOptions = {}
): Promise<ConsoleIntegration & { config: TConfig }> {
  const code = stringValue(integrationCode)
  if (!code) {
    throw createError({ statusCode: 400, message: 'integrationCode is required' })
  }

  return await fetchConsoleIntegrationApi<ConsoleIntegration & { config: TConfig }>(
    `/api/v1/console/integrations/${encodeURIComponent(code)}`,
    {
      audience: 'integration_config',
      scope: 'integration_config:view',
      event: options.event
    }
  )
}

export async function resolveIntegrationSecret(input: {
  integrationCode: string
  purpose: string
}, options: IntegrationRuntimeOptions = {}) {
  const integration = await getIntegrationConfig(input.integrationCode, options)
  const credential = integration.currentCredential
  if (!credential?.secretRef) {
    throw createError({ statusCode: 409, message: `Integration ${input.integrationCode} has no active credential` })
  }

  const result = await fetchConsoleIntegrationApi<{
    secretCode: string
    secretRef: string
    versionNo: number
    value: string
  }>('/api/v1/console/vault/resolve', {
    method: 'POST',
    audience: 'credential_vault',
    scope: 'credential_vault:resolve',
    body: {
      secretRef: credential.secretRef,
      purpose: input.purpose
    },
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

export async function getGitLabRuntimeConfig(integrationCode = 'gitlab.default'): Promise<GitLabRuntimeConfig> {
  const config = await getIntegrationRuntimeConfig<GitLabRuntimeConfig['config']>(integrationCode)
  const token = await resolveIntegrationSecret({
    integrationCode,
    purpose: 'gitlab_runtime'
  })
  return {
    ...config,
    token
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

export async function getWecomRuntimeConfig(integrationCode = 'wecom.default'): Promise<WecomRuntimeConfig> {
  const runtime = await getIntegrationRuntimeConfig<WecomRuntimeConfig['config']>(integrationCode)
  const corpid = getConfigValue(runtime.config, ['corpid', 'corpId'])
  const agentid = getConfigValue(runtime.config, ['agentid', 'agentId'])
  if (!corpid || !agentid) {
    throw createError({
      statusCode: 409,
      message: `Integration ${integrationCode} is missing corpid or agentid`
    })
  }

  const corpsecret = await resolveIntegrationSecret({
    integrationCode,
    purpose: 'wecom_runtime'
  })
  return {
    ...runtime,
    corpid,
    agentid,
    corpsecret
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
