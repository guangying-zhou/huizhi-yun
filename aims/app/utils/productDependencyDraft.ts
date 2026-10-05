// Reapply only the user's changes to the freshly loaded complete server set.
// Unchanged local rows do not restore relations another editor has removed.
export function mergeProductDependencyDraft<T extends { biz_id: string }>(original: T[], draft: T[], latest: T[]): T[] {
  for (const set of [original, draft, latest]) {
    if (set.some(item => !item.biz_id) || new Set(set.map(item => item.biz_id)).size !== set.length) throw new Error('依赖集合存在重复或缺失标识')
  }
  const oldIds = new Set(original.map(item => item.biz_id))
  const draftIds = new Set(draft.map(item => item.biz_id))
  const removed = new Set(original.filter(item => !draftIds.has(item.biz_id)).map(item => item.biz_id))
  const merged = new Map(latest.filter(item => !removed.has(item.biz_id)).map(item => [item.biz_id, { ...item }]))
  for (const item of draft) if (!oldIds.has(item.biz_id) && !merged.has(item.biz_id)) merged.set(item.biz_id, { ...item })
  if (merged.size > 100) throw new Error('合并后前置超过 100 项，请保留当前草稿并先协调缩小范围')
  return [...merged.values()]
}
