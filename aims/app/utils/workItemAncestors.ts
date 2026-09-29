export interface WorkItemAncestor {
  id: number
  parentId: number | null
  itemKey: string
  title: string
}

export function workItemAncestorPath(parentId: number | null, ancestors: WorkItemAncestor[]): string {
  const byId = new Map(ancestors.map(item => [item.id, item]))
  const path: string[] = []
  const seen = new Set<number>()
  let id = parentId
  while (id !== null && path.length < 64 && !seen.has(id)) {
    seen.add(id)
    const item = byId.get(id)
    if (!item) break
    path.unshift(item.itemKey || item.title)
    id = item.parentId
  }
  return path.join(' / ')
}
