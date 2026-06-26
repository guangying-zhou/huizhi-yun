import { $fetch } from 'ofetch'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ScheduledRuntimeOptions {
  scope: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
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
    const value = stringValue(current)
    if (value) return value
  }
  return ''
}

function envValue(names: string[]) {
  for (const name of names) {
    const value = stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function appEnvPart(appCode: string) {
  return appCode.replace(/[^a-z0-9]/gi, '_').toUpperCase()
}

function scheduledRuntimeEndpoint(config: Record<string, unknown>, appCode: string) {
  const appPart = appEnvPart(appCode)
  return getConfigValue(config, [
    'hzy.tenantRuntime.endpoint',
    'tenantRuntime.endpoint',
    'hzy.dataRuntime.endpoint',
    'dataRuntime.endpoint'
  ]) || envValue([
    `HZY_${appPart}_TENANT_RUNTIME_URL`,
    'HZY_TENANT_RUNTIME_URL',
    `HZY_${appPart}_DATA_RUNTIME_URL`,
    'HZY_DATA_RUNTIME_URL'
  ])
}

function scheduledRuntimeStaticToken(config: Record<string, unknown>, appCode: string) {
  const appPart = appEnvPart(appCode)
  return getConfigValue(config, [
    'hzy.tenantRuntime.token',
    'tenantRuntime.token',
    'hzy.dataRuntime.token',
    'dataRuntime.token'
  ]) || envValue([
    `HZY_${appPart}_TENANT_RUNTIME_TOKEN`,
    'HZY_TENANT_RUNTIME_TOKEN',
    `HZY_${appPart}_DATA_RUNTIME_TOKEN`,
    'HZY_DATA_RUNTIME_TOKEN'
  ])
}

function scheduledRuntimeAudience(config: Record<string, unknown>) {
  return envValue([
    'HZY_DATA_RUNTIME_AUDIENCE'
  ]) || getConfigValue(config, [
    'hzy.dataRuntime.audience',
    'dataRuntime.audience'
  ]) || getConfigValue(config, [
    'hzy.tenantRuntime.audience',
    'tenantRuntime.audience'
  ]) || envValue([
    'HZY_TENANT_RUNTIME_AUDIENCE'
  ]) || 'data-runtime'
}

function scheduledRuntimeContextHeaders(config: Record<string, unknown>) {
  const tenant = getConfigValue(config, [
    'hzy.tenantRuntime.tenant',
    'tenantRuntime.tenant',
    'hzy.dataRuntime.tenant',
    'dataRuntime.tenant'
  ]) || envValue(['HZY_TENANT_RUNTIME_TENANT', 'HZY_DATA_RUNTIME_TENANT'])
  const deployment = getConfigValue(config, [
    'hzy.tenantRuntime.deployment',
    'tenantRuntime.deployment',
    'hzy.dataRuntime.deployment',
    'dataRuntime.deployment'
  ]) || envValue(['HZY_TENANT_RUNTIME_DEPLOYMENT', 'HZY_DATA_RUNTIME_DEPLOYMENT'])
  return {
    ...(tenant ? { 'x-hzy-tenant': tenant } : {}),
    ...(deployment ? { 'x-hzy-deployment': deployment } : {})
  }
}

function tenantRuntimeTokenScope(audience: string, scope: string): string {
  const normalizedAudience = stringValue(audience)
  const normalizedScope = stringValue(scope)
  if (!normalizedAudience || !normalizedScope) return normalizedScope
  const scopes = normalizedScope.split(/\s+/).filter(Boolean)
  if (scopes.length > 1) {
    return scopes.map(item => tenantRuntimeTokenScope(normalizedAudience, item)).join(' ')
  }
  if (normalizedScope.startsWith(`${normalizedAudience}:`)) return normalizedScope

  const [appCode, action] = normalizedScope.split(/\.(.+)/).filter(Boolean)
  if (!appCode || !action) return normalizedScope

  return `${normalizedAudience}:${appCode}:${action}`
}

async function scheduledRuntimeBearerToken(config: Record<string, unknown>, appCode: string, scope: string) {
  const staticToken = scheduledRuntimeStaticToken(config, appCode)
  if (staticToken) return staticToken

  const audience = scheduledRuntimeAudience(config)
  return await requestServiceAccessToken({
    audience,
    scope: tenantRuntimeTokenScope(audience, scope)
  })
}

export async function callAltocScheduledRuntime<T>(
  path: string,
  options: ScheduledRuntimeOptions
): Promise<T> {
  const appCode = 'altoc'
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = scheduledRuntimeEndpoint(config, appCode)
  if (!endpoint) {
    throw new Error('Altoc tenant-runtime endpoint is not configured for scheduled task.')
  }

  const url = new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`)
  const method = options.method || 'POST'
  const data = await $fetch<RuntimeEnvelope<T>>(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${await scheduledRuntimeBearerToken(config, appCode, options.scope)}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...scheduledRuntimeContextHeaders(config)
    },
    ...(method === 'GET' ? {} : { body: options.body ?? {} }),
    timeout: 10000
  })
  if (data.code !== undefined && data.code !== 0) {
    throw new Error(data.message || 'Altoc tenant-runtime returned an error.')
  }
  return data.data as T
}
