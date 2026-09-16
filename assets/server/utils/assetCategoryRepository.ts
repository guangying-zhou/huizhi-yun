import { createError } from 'h3'
import {
  assetCategoryScopeMap,
  managedAssetCategoryDictionaryCodes,
  type AssetCategoryScope
} from '~~/shared/assetCategoryDefaults'
import type { AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'

export interface AssetCategoryItem {
  id: number
  value: string
  label: string
  shortCode?: string
  description?: string
  enabled: boolean
  sortOrder: number
}

export interface AssetCategoryGroup {
  id: number
  scope: AssetCategoryScope
  value: string
  label: string
  shortCode?: string
  description?: string
  enabled: boolean
  sortOrder: number
  items: AssetCategoryItem[]
}

interface AssetCategoryWritePayload {
  label?: string
  value?: string
  shortCode?: string
  description?: string
  enabled?: boolean
  sortOrder?: number
  items?: Array<{
    label?: string
    value?: string
    shortCode?: string
    description?: string
    enabled?: boolean
    sortOrder?: number
  }>
}

function tenantRuntimeOnly(): never {
  throw createError({
    statusCode: 503,
    message: 'Assets category APIs are served by tenant-runtime/data-runtime. Local database repositories are disabled.'
  })
}

async function unavailable<T = never>(): Promise<T> {
  return tenantRuntimeOnly()
}

export function normalizeAssetCategoryScope(input: unknown): AssetCategoryScope {
  const scope = typeof input === 'string' ? input : 'physical'

  if (scope in assetCategoryScopeMap) {
    return scope as AssetCategoryScope
  }

  throw createError({ statusCode: 400, message: '不支持的资产类别作用域' })
}

export async function listAssetCategories(..._args: unknown[]) {
  return unavailable<AssetCategoryGroup[]>()
}

export async function listPhysicalAssetCategories(..._args: unknown[]) {
  return unavailable<AssetCategoryGroup[]>()
}

export async function getAssetCategoryDictionaryDefinition(..._args: unknown[]): Promise<AssetDictionaryDefinition> {
  return unavailable()
}

export async function getManagedAssetCategoryDictionaryDefinitions(): Promise<AssetDictionaryDefinition[]> {
  return unavailable()
}

export async function getPhysicalSubtypeDictionaryDefinition(): Promise<AssetDictionaryDefinition> {
  return unavailable()
}

export async function saveAssetCategory(
  _scope: AssetCategoryScope,
  _id: number | null,
  _payload: AssetCategoryWritePayload,
  _operatorUid: string | null
) {
  return unavailable<AssetCategoryGroup | null>()
}

export async function savePhysicalAssetCategory(
  _id: number | null,
  _payload: AssetCategoryWritePayload,
  _operatorUid: string | null
) {
  return unavailable<AssetCategoryGroup | null>()
}

export async function getPhysicalAssetCodeTokens(..._args: unknown[]) {
  return unavailable<{ subtypeToken: string, itemTypeToken: string }>()
}

export async function getAssetCategoryScopeById(..._args: unknown[]) {
  return unavailable<AssetCategoryScope>()
}

export { managedAssetCategoryDictionaryCodes }
