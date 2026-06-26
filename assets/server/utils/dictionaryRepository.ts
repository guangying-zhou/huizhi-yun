import { createError } from 'h3'
import type { AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'

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

function tenantRuntimeOnly(): never {
  throw createError({
    statusCode: 503,
    message: 'Assets dictionary APIs are served by tenant-runtime/data-runtime. Local database repositories are disabled.'
  })
}

async function unavailable<T = never>(): Promise<T> {
  return tenantRuntimeOnly()
}

export async function getAllDictionaries(): Promise<AssetDictionaryDefinition[]> {
  return unavailable()
}

export async function updateDictionary(_code: string, _payload: DictionaryPayload): Promise<AssetDictionaryDefinition> {
  return unavailable()
}
