export interface OpenDepartmentFolderLike {
  id: unknown
  parent_id?: unknown
  is_open?: unknown
}

export interface OpenDepartmentSortableFolderLike extends OpenDepartmentFolderLike {
  name?: unknown
  sort_order?: unknown
}

export function normalizeOpenDepartmentFolderId(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function isOpenDepartmentFolderFlag(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function openDepartmentFolderIdSet(folders: OpenDepartmentFolderLike[]) {
  const byParent = new Map<number, OpenDepartmentFolderLike[]>()
  const openIds = new Set<number>()

  for (const folder of folders) {
    const id = normalizeOpenDepartmentFolderId(folder.id)
    if (!id) continue
    if (isOpenDepartmentFolderFlag(folder.is_open)) openIds.add(id)

    const parentId = normalizeOpenDepartmentFolderId(folder.parent_id)
    if (!parentId) continue
    const siblings = byParent.get(parentId) || []
    siblings.push(folder)
    byParent.set(parentId, siblings)
  }

  const included = new Set(openIds)
  const queue = [...openIds]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const child of byParent.get(parentId) || []) {
      const childId = normalizeOpenDepartmentFolderId(child.id)
      if (!childId || included.has(childId)) continue
      included.add(childId)
      queue.push(childId)
    }
  }

  return included
}

export function openDepartmentVisibleFolderMap<T extends OpenDepartmentFolderLike>(folders: T[]) {
  const visibleIds = openDepartmentFolderIdSet(folders)
  const visibleFolders = new Map<number, T>()

  for (const folder of folders) {
    const id = normalizeOpenDepartmentFolderId(folder.id)
    if (visibleIds.has(id)) {
      visibleFolders.set(id, folder)
    }
  }

  return visibleFolders
}

export function compareOpenDepartmentFolderNames(a: OpenDepartmentSortableFolderLike, b: OpenDepartmentSortableFolderLike) {
  const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
  if (nameCompare !== 0) return nameCompare

  const sortA = Number(a.sort_order || 0)
  const sortB = Number(b.sort_order || 0)
  if (sortA !== sortB) return sortA - sortB

  return normalizeOpenDepartmentFolderId(a.id) - normalizeOpenDepartmentFolderId(b.id)
}
