import type { AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'
import { assetDictionaryDefinitions, assetDictionaryMap } from '~~/shared/assetsDictionaries'

function cloneDefinitions() {
  return assetDictionaryDefinitions.reduce<Record<string, AssetDictionaryDefinition>>((acc, item) => {
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

export function useAssetDictionaries() {
  const definitionSignature = buildDefinitionSignature()
  const dictionaries = useState<Record<string, AssetDictionaryDefinition>>('assets-dictionaries', () => cloneDefinitions())
  const loaded = useState<boolean>('assets-dictionaries-loaded', () => false)
  const version = useState<string>('assets-dictionaries-version', () => '')

  if (version.value !== definitionSignature) {
    dictionaries.value = cloneDefinitions()
    loaded.value = false
    version.value = definitionSignature
  }

  async function loadDictionaries(force = false) {
    if (loaded.value && !force) {
      return
    }

    try {
      const response = await $fetch<{
        code: number
        data: {
          items: AssetDictionaryDefinition[]
        }
      }>('/api/v1/dictionaries')

      const next = cloneDefinitions()
      for (const item of response.data?.items || []) {
        next[item.code] = item
      }
      dictionaries.value = next
    } catch (error) {
      console.error('[Dictionaries] Failed to load:', error)
      dictionaries.value = cloneDefinitions()
    } finally {
      loaded.value = true
    }
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
