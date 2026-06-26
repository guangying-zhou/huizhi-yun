import {
  assetCategoryDefaultsByScope,
  type AssetCategoryScope
} from '~~/shared/assetCategoryDefaults'
import type { AssetCategoryGroup, AssetCategoryItem } from '~/types'

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function boolValue(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    return !['0', 'false', 'disabled'].includes(value.toLowerCase())
  }
  return fallback
}

function sortByOrder<T extends { sortOrder?: number }>(items: T[]) {
  return items.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

function normalizeItem(raw: unknown, index: number): AssetCategoryItem | null {
  if (!isRecord(raw)) {
    return null
  }

  const value = stringValue(raw.value) || stringValue(raw.item_value)
  const label = stringValue(raw.label) || stringValue(raw.item_label) || value
  if (!value || !label) {
    return null
  }

  return {
    id: numberValue(raw.id, index + 1),
    value,
    label,
    shortCode: stringValue(raw.shortCode) || stringValue(raw.short_code) || undefined,
    description: stringValue(raw.description) || undefined,
    enabled: boolValue(raw.enabled),
    sortOrder: numberValue(raw.sortOrder ?? raw.sort_order, index + 1)
  }
}

function normalizeGroup(raw: unknown, scope: AssetCategoryScope, index: number): AssetCategoryGroup | null {
  if (!isRecord(raw)) {
    return null
  }

  const value = stringValue(raw.value) || stringValue(raw.category_value)
  const label = stringValue(raw.label) || stringValue(raw.category_label) || value
  if (!value || !label) {
    return null
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : []
  return {
    id: numberValue(raw.id, index + 1),
    scope: stringValue(raw.scope || raw.category_scope) as AssetCategoryScope || scope,
    value,
    label,
    shortCode: stringValue(raw.shortCode) || stringValue(raw.short_code) || undefined,
    description: stringValue(raw.description) || undefined,
    enabled: boolValue(raw.enabled),
    sortOrder: numberValue(raw.sortOrder ?? raw.sort_order, index + 1),
    items: sortByOrder(rawItems.map(normalizeItem).filter(item => item !== null))
  }
}

function normalizeCompatItemRows(rawItems: unknown[], scope: AssetCategoryScope): AssetCategoryGroup[] {
  const defaultGroups = assetCategoryDefaultsByScope[scope] || []
  const defaultByItemValue = new Map<string, { group: typeof defaultGroups[number], groupIndex: number }>()

  defaultGroups.forEach((group, groupIndex) => {
    group.items.forEach((item) => {
      defaultByItemValue.set(item.value, { group, groupIndex })
      defaultByItemValue.set(item.label, { group, groupIndex })
    })
  })

  const byGroup = new Map<string, AssetCategoryGroup>()

  rawItems.forEach((raw, index) => {
    if (!isRecord(raw)) {
      return
    }

    const item = normalizeItem(raw, index)
    if (!item) {
      return
    }

    const matchedDefault = defaultByItemValue.get(item.value) || defaultByItemValue.get(item.label)
    const rawGroupID = numberValue(raw.group_id, 0)
    const groupKey = matchedDefault?.group.value || `group:${rawGroupID || item.value}`
    let group = byGroup.get(groupKey)

    if (!group) {
      const defaultGroup = matchedDefault?.group
      group = {
        id: rawGroupID || (matchedDefault ? matchedDefault.groupIndex + 1 : index + 1),
        scope,
        value: defaultGroup?.value || groupKey,
        label: defaultGroup?.label || `分组 ${rawGroupID || index + 1}`,
        shortCode: defaultGroup?.shortCode,
        description: defaultGroup?.description,
        enabled: defaultGroup?.enabled !== false,
        sortOrder: defaultGroup?.sortOrder || rawGroupID || index + 1,
        items: []
      }
      byGroup.set(groupKey, group)
    }

    group.items.push(item)
  })

  return sortByOrder([...byGroup.values()].map(group => ({
    ...group,
    items: sortByOrder(group.items)
  })))
}

export function normalizeAssetCategoryGroups(rawItems: unknown, scope: AssetCategoryScope): AssetCategoryGroup[] {
  const items = Array.isArray(rawItems) ? rawItems : []
  const groups = items
    .map((item, index) => normalizeGroup(item, scope, index))
    .filter(item => item !== null)

  if (groups.length > 0) {
    return sortByOrder(groups.map(group => ({
      ...group,
      items: sortByOrder(group.items || [])
    })))
  }

  return normalizeCompatItemRows(items, scope)
}
