import { createError } from 'h3'
import { $fetch, FetchError } from 'ofetch'
import { useRuntimeConfig } from '#imports'

interface RequestOptions {
  timeoutMs?: number
}

interface ProblemDetails {
  detail?: string
  message?: string
  status?: number
}

function buildHeaders(apiKey: string | undefined) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

export async function postIngestionService<T>(
  endpoint: string,
  payload: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const config = useRuntimeConfig()
  const ingestionServiceConfig = (config as {
    ingestionService?: {
      baseUrl?: string
      apiKey?: string
    }
  }).ingestionService
  const baseUrl = ingestionServiceConfig?.baseUrl
  const apiKey = ingestionServiceConfig?.apiKey

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Ingestion service base URL is not configured'
    })
  }

  try {
    return await $fetch<T>(endpoint, {
      baseURL: baseUrl,
      method: 'POST',
      body: payload as Record<string, unknown>,
      headers: buildHeaders(apiKey),
      timeout: options.timeoutMs ?? 60_000
    })
  } catch (error) {
    if (error instanceof FetchError) {
      const response = error.response?._data as ProblemDetails | undefined
      const statusCode = error.response?.status ?? 502
      const message = response?.detail
        || response?.message
        || error.message
        || 'Ingestion service request failed'
      throw createError({
        statusCode,
        statusMessage: message
      })
    }
    throw createError({
      statusCode: 500,
      statusMessage: (error as Error).message || 'Unknown ingestion service error'
    })
  }
}
