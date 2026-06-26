import { getAiProviderRuntimeConfig } from './integrationConfig'

export interface AiProviderRequestOptions {
  integrationCode?: string
  path: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeout?: number
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizePath(value: string) {
  return value.startsWith('/') ? value : `/${value}`
}

export async function getAiProviderIntegrationConfig(integrationCode = 'ai.default') {
  const runtime = await getAiProviderRuntimeConfig(integrationCode)
  return {
    integrationCode: runtime.integrationCode,
    baseUrl: trimSlash(runtime.baseUrl),
    apiKey: runtime.apiKey,
    defaultModel: String(runtime.config.defaultModel || runtime.config.model || ''),
    config: runtime.config,
    secretVersionNo: runtime.secretVersionNo
  }
}

export async function aiProviderFetch<T>(options: AiProviderRequestOptions): Promise<T> {
  const config = await getAiProviderIntegrationConfig(options.integrationCode)
  const externalFetch = $fetch as unknown as <R>(request: string, options: {
    method?: string
    headers?: Record<string, string>
    body?: Record<string, unknown>
    timeout?: number
  }) => Promise<R>

  return await externalFetch<T>(`${config.baseUrl}${normalizePath(options.path)}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: options.body,
    timeout: options.timeout || 30000
  })
}
