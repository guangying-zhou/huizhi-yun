import { createError } from 'h3'
import type { H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { assetDictionaryDefinitions, type AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'

interface DictionaryPayload {
  name?: string
  description?: string
  options?: Array<{
    label?: string
    value?: string
    description?: string
    enabled?: boolean
    sortOrder?: number
  }>
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface RuntimeDictionaryPage {
  items?: AssetDictionaryDefinition[]
}

function tenantRuntimeOnly(): never {
  throw createError({
    statusCode: 503,
    message: 'Assets dictionary APIs are served by tenant-runtime/data-runtime. Local database repositories are disabled.'
  })
}

async function unavailable<T = never>(): Promise<T> {
  return tenantRuntimeOnly()
}

function cloneDefinitions() {
  return assetDictionaryDefinitions.reduce<Record<string, AssetDictionaryDefinition>>((acc, item) => {
    acc[item.code] = {
      ...item,
      options: item.options.map(option => ({ ...option }))
    }
    return acc
  }, {})
}

function normalizeRuntimeDictionary(item: AssetDictionaryDefinition): AssetDictionaryDefinition | null {
  const code = String(item?.code || '').trim()
  if (!code) return null
  return {
    code,
    name: String(item.name || code).trim(),
    description: String(item.description || '').trim(),
    options: Array.isArray(item.options)
      ? item.options
          .map((option, index) => ({
            label: String(option?.label || '').trim(),
            value: String(option?.value || '').trim(),
            description: option?.description ? String(option.description).trim() : undefined,
            enabled: option?.enabled !== false,
            sortOrder: Number.isFinite(Number(option?.sortOrder)) ? Number(option.sortOrder) : index + 1
          }))
          .filter(option => option.label && option.value)
      : []
  }
}

async function loadRuntimeDictionaries(event: H3Event) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeDictionaryPage>>(event, '/v1/assets/dictionaries', {
    appCode: 'assets',
    scope: 'assets.read',
    method: 'GET'
  })

  if (!runtime.handled) return []

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) return []
  return envelope.data?.items || []
}

export async function getAllDictionaries(event?: H3Event): Promise<AssetDictionaryDefinition[]> {
  const definitions = cloneDefinitions()

  if (event) {
    try {
      const runtimeItems = await loadRuntimeDictionaries(event)
      for (const item of runtimeItems) {
        const normalized = normalizeRuntimeDictionary(item)
        if (normalized) definitions[normalized.code] = normalized
      }
    } catch (error) {
      console.warn('[AssetsDictionaries] Failed to load runtime dictionaries:', error)
    }
  }

  return Object.values(definitions)
}

export async function updateDictionary(_code: string, _payload: DictionaryPayload): Promise<AssetDictionaryDefinition> {
  return unavailable()
}
