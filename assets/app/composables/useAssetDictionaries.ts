import { useAssetsModule } from '../../layer/useAssetsModule'
import type { AssetDictionaryDefinition } from '../../shared/assetsDictionaries'
import { assetCategoryScopeDefinitions } from '../../shared/assetCategoryDefaults'
import { assetDictionaryDefinitions, assetDictionaryMap } from '../../shared/assetsDictionaries'
import type { AssetCategoryGroup } from '../types'
import { normalizeAssetCategoryGroups } from '../utils/assetCategories'

type DictionaryMap = Record<string, AssetDictionaryDefinition>

function cloneDefinitions() {
  return assetDictionaryDefinitions.reduce<DictionaryMap>((acc, item) => {
    acc[item.code] = {
      ...item,
      options: item.options.map(option => ({ ...option }))
    }
    return acc
  }, {})
}

function buildDefinitionSignature() {
  return JSON.stringify(assetDictionaryDefinitions.map(item => ({
    code: item.code,
    name: item.name,
    description: item.description,
    options: item.options.map(option => ({
      label: option.label,
      value: option.value,
      enabled: option.enabled !== false,
      sortOrder: option.sortOrder ?? null
    }))
  })))
}

async function loadStoredDictionaries(target: DictionaryMap, moduleUrl: (path: string) => string, hostedAssetItems = false) {
  try {
    const response = await $fetch<{
      data?: {
        items?: AssetDictionaryDefinition[]
      }
    }>(moduleUrl(hostedAssetItems ? '/api/v1/asset-dictionaries' : '/api/v1/dictionaries'))

    for (const item of response.data?.items || []) {
      if (!item.code) continue
      target[item.code] = {
        ...item,
        options: (item.options || []).map((option, index) => ({
          label: option.label,
          value: option.value,
          description: option.description,
          enabled: option.enabled !== false,
          sortOrder: option.sortOrder ?? index + 1
        }))
      }
    }
  } catch (error) {
    // Hosted asset-item pages must not render their local defaults as though a
    // denied dictionary BFF had supplied them.  Standalone and product pages
    // retain their existing resilient local fallback.
    if (hostedAssetItems) throw error
    console.warn('[Dictionaries] Failed to load stored dictionaries:', error)
  }
}

async function loadManagedCategoryDictionaries(target: DictionaryMap, moduleUrl: (path: string) => string, hosted = false) {
  const results = await Promise.allSettled(assetCategoryScopeDefinitions.filter(item => !hosted || item.scope === 'product').map(async (scopeDefinition) => {
    const response = await $fetch<{
      data?: {
        items?: AssetCategoryGroup[]
      }
    }>(moduleUrl('/api/v1/asset-categories'), {
      query: { scope: scopeDefinition.scope, pageSize: 500 }
    })

    const categories = normalizeAssetCategoryGroups(response.data?.items, scopeDefinition.scope)
    const options = categories
      .filter(category => category.enabled !== false)
      .map(category => ({
        label: category.label,
        value: category.value,
        description: category.description || undefined,
        enabled: category.enabled,
        sortOrder: category.sortOrder
      }))

    return {
      scopeDefinition,
      options
    }
  }))

  for (const result of results) {
    if (result.status !== 'fulfilled' || result.value.options.length === 0) {
      continue
    }

    const { scopeDefinition, options } = result.value
    target[scopeDefinition.dictionaryCode] = {
      code: scopeDefinition.dictionaryCode,
      name: scopeDefinition.groupLabel,
      description: scopeDefinition.description,
      options
    }
  }
}

export function useAssetDictionaries(scope: 'default' | 'asset-items' = 'default') {
  const { moduleUrl, cacheKey, hosted } = useAssetsModule()
  const definitionSignature = buildDefinitionSignature()
  const dictionaries = useState<DictionaryMap>(cacheKey('assets-dictionaries'), () => cloneDefinitions())
  const loaded = useState<boolean>(cacheKey('assets-dictionaries-loaded'), () => false)
  const version = useState<string>(cacheKey('assets-dictionaries-version'), () => '')

  if (version.value !== definitionSignature) {
    dictionaries.value = cloneDefinitions()
    loaded.value = false
    version.value = definitionSignature
  }

  async function loadDictionaries(force = false) {
    if (loaded.value && !force) {
      return
    }

    const nextDictionaries = cloneDefinitions()
    await loadStoredDictionaries(nextDictionaries, moduleUrl, hosted && scope === 'asset-items')
    await loadManagedCategoryDictionaries(nextDictionaries, moduleUrl, hosted)
    dictionaries.value = nextDictionaries
    loaded.value = true
  }

  function getDictionary(code: string) {
    return dictionaries.value[code] || assetDictionaryMap[code]
  }

  function getOptions(code: string) {
    return (getDictionary(code)?.options || [])
      .filter(option => option.enabled !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }

  return {
    dictionaries,
    loaded,
    loadDictionaries,
    getDictionary,
    getOptions
  }
}
