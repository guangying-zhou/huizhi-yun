import { createError } from 'h3'
import { getConsoleRuntimeConfig, resolveConsoleRuntimeBaseUrl } from './consoleRuntime'
import { requestServiceAccessToken } from './serviceOidc'

type ConsoleApiResponse<T> = {
  code?: number
  data?: T
  message?: string
}

type RuntimeSettingValue = {
  settingKey: string
  value: unknown
}

type RuntimeSettingCacheEntry = {
  value: unknown
  expiresAt: number
}

const runtimeSettingCache = new Map<string, RuntimeSettingCacheEntry>()

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

    if (current !== undefined && current !== null && stringValue(current)) {
      return stringValue(current)
    }
  }

  return ''
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

export function getConsoleRuntimeSettingsBaseUrl(config = useRuntimeConfig() as unknown as Record<string, unknown>) {
  const configured = getConfigValue(config, [
    'hzy.runtime.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.integration.consoleApiUrl',
    'hzy.consoleApiUrl'
  ]) || process.env.HZY_CONSOLE_API_URL || process.env.HZY_CONSOLE_URL || getConfigValue(config, [
    'public.consoleUrl'
  ]) || resolveConsoleRuntimeBaseUrl(config)

  return normalizeBaseUrl(configured || '')
}

export async function fetchRuntimeSettings(keys: string[]) {
  const normalizedKeys = [...new Set(keys.map(stringValue).filter(Boolean))].sort()
  if (!normalizedKeys.length) {
    return {}
  }

  const runtime = await getConsoleRuntimeConfig().catch(() => null)
  const baseUrl = normalizeBaseUrl(runtime?.console.baseUrl || getConsoleRuntimeSettingsBaseUrl())
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console runtime settings URL is not configured' })
  }

  const accessToken = await requestServiceAccessToken({
    audience: 'system_settings',
    scope: 'system_settings:view'
  })

  const response = await $fetch<ConsoleApiResponse<{ items: RuntimeSettingValue[] }>>(
    `${baseUrl}/api/v1/console/settings/values`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      params: {
        keys: normalizedKeys.join(',')
      },
      timeout: 10000
    }
  )

  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Console settings API returned an error'
    })
  }

  return (response.data?.items || []).reduce<Record<string, unknown>>((acc, item) => {
    acc[item.settingKey] = item.value
    return acc
  }, {})
}

export async function getRuntimeSetting<T = unknown>(
  key: string,
  fallback?: T,
  options: { ttlMs?: number, forceRefresh?: boolean } = {}
): Promise<T | undefined> {
  const settingKey = stringValue(key)
  if (!settingKey) return fallback

  const ttlMs = Math.max(5000, options.ttlMs || 60000)
  const cached = runtimeSettingCache.get(settingKey)
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value as T
  }

  try {
    const settings = await fetchRuntimeSettings([settingKey])
    const value = settings[settingKey]
    if (value !== undefined) {
      runtimeSettingCache.set(settingKey, {
        value,
        expiresAt: Date.now() + ttlMs
      })
      return value as T
    }
  } catch (error) {
    if (fallback === undefined) {
      throw error
    }
  }

  return fallback
}
