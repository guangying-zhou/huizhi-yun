import type { AssetCategoryScope } from '~~/shared/assetCategoryDefaults'
import type { AssetCategoryGroup } from '~/types'
import { normalizeAssetCategoryGroups } from '~/utils/assetCategories'

function sortByOrder<T extends { sortOrder?: number }>(items: T[]) {
  return items.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

export function useAssetCategories(scope: AssetCategoryScope = 'physical') {
  const categories = useState<AssetCategoryGroup[]>(`asset-categories-${scope}`, () => [])
  const loaded = useState<boolean>(`asset-categories-${scope}-loaded`, () => false)

  async function loadCategories(force = false) {
    if (loaded.value && !force) {
      return
    }

    const response = await $fetch<{
      code: number
      data: {
        items: AssetCategoryGroup[]
      }
    }>('/api/v1/asset-categories', {
      query: { scope, pageSize: 500 }
    })

    categories.value = normalizeAssetCategoryGroups(response.data?.items, scope)
    loaded.value = true
  }

  const subtypeOptions = computed(() => sortByOrder(categories.value)
    .filter(category => category.enabled !== false)
    .map(category => ({
      label: category.label,
      value: category.value,
      description: category.description || '',
      sortOrder: category.sortOrder
    })))

  function getItemTypeOptions(subtype: string | null | undefined) {
    const category = categories.value.find(item => item.value === (subtype || ''))
    return sortByOrder((category?.items || []).filter(item => item.enabled !== false))
      .map(item => ({
        label: item.label,
        value: item.value,
        description: item.description || '',
        sortOrder: item.sortOrder
      }))
  }

  function getDefaultItemType(subtype: string | null | undefined) {
    return getItemTypeOptions(subtype)[0]?.value || ''
  }

  return {
    categories,
    loaded,
    loadCategories,
    subtypeOptions,
    getItemTypeOptions,
    getDefaultItemType
  }
}
