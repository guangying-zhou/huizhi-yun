import { createError, type H3Event } from 'h3'
import { $fetch } from 'ofetch'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

function text(value: unknown) {
  return String(value || '').trim()
}

function nested(config: Record<string, unknown>, path: string) {
  let value: unknown = config
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    value = (value as Record<string, unknown>)[key]
  }
  return text(value)
}

function taskRuntimeBinding() {
  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const endpoint = text(
    process.env.HZY_CONSOLE_TENANT_RUNTIME_URL
    || process.env.HZY_TENANT_RUNTIME_URL
    || process.env.HZY_CONSOLE_DATA_RUNTIME_URL
    || process.env.HZY_DATA_RUNTIME_URL
  ) || nested(config, 'hzy.tenantRuntime.endpoint')
  || nested(config, 'tenantRuntime.endpoint')
  || nested(config, 'hzy.dataRuntime.endpoint')
  || nested(config, 'dataRuntime.endpoint')
  const token = text(
    process.env.HZY_CONSOLE_TENANT_RUNTIME_TOKEN
    || process.env.HZY_TENANT_RUNTIME_TOKEN
    || process.env.HZY_CONSOLE_DATA_RUNTIME_TOKEN
    || process.env.HZY_DATA_RUNTIME_TOKEN
  ) || nested(config, 'hzy.tenantRuntime.token')
  || nested(config, 'tenantRuntime.token')
  || nested(config, 'hzy.dataRuntime.token')
  || nested(config, 'dataRuntime.token')
  if (!endpoint || !token) {
    throw createError({
      statusCode: 503,
      message: 'Scheduled Console lifecycle drain requires an enrolled Tenant Runtime endpoint and static/gateway token.'
    })
  }
  return { endpoint: endpoint.replace(/\/+$/u, ''), token }
}

export async function callConsoleTenantRuntimeTask<T>(
  path: `/v1/console/${string}`,
  options: { method?: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, unknown> } = {}
) {
  const binding = taskRuntimeBinding()
  return await $fetch<T>(`${binding.endpoint}${path}`, {
    method: options.method || 'GET',
    headers: {
      'authorization': `Bearer ${binding.token}`,
      'x-request-id': crypto.randomUUID()
    },
    query: options.query,
    body: options.body,
    retry: 0,
    timeout: 15_000
  })
}

export async function callConsoleTenantRuntimeTaskForEvent<T>(
  event: H3Event,
  path: `/v1/console/${string}`,
  options: { method?: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, unknown> } = {}
) {
  const response = await maybeCallTenantRuntime<T>(event, path, {
    appCode: 'console',
    scope: 'console:platform-lifecycle:execute',
    method: options.method || 'GET',
    body: options.body,
    query: options.query
  })
  if (!response.handled) {
    throw createError({
      statusCode: 503,
      message: 'Tenant Gateway scheduler did not provide an enrolled Console Tenant Runtime endpoint.'
    })
  }
  return response.data
}
