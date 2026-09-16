export type Scope = { id: number, title: string, description: string | null, status: string, acceptance_criteria: string | null, product_feature_biz_id: string | null, planning_item_biz_id: string | null, change_type: string | null, category: string | null, is_public: boolean, sort_order: number, legacy_unscored: boolean, deferred_from_feature_id: number | null }
export type Change = { scope_id: number, kind: string, before: Scope | null, after: Scope | null }
export type Diff = { product_code: string, before_record_id: number, after_record_id: number, before_content_hash: string, after_content_hash: string, added: number, removed: number, changed: number, unchanged: number, total: number, page: number, pageSize: number, changes: Change[] }

const textOrNull = (value: unknown) => value === null || typeof value === 'string'
const uuidOrNull = (value: unknown) => value === null || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
export function validReleaseScope(scope: Scope | null, id: number): boolean {
  return !!scope && scope.id === id && typeof scope.title === 'string' && !!scope.title.trim() && ['planned', 'delivered', 'deferred'].includes(scope.status) && [scope.description, scope.acceptance_criteria, scope.category].every(textOrNull) && [scope.product_feature_biz_id, scope.planning_item_biz_id].every(uuidOrNull) && (scope.change_type === null || ['new', 'enhancement', 'fix', 'retirement'].includes(scope.change_type)) && typeof scope.is_public === 'boolean' && typeof scope.legacy_unscored === 'boolean' && Number.isSafeInteger(scope.sort_order) && (scope.deferred_from_feature_id === null || (Number.isSafeInteger(scope.deferred_from_feature_id) && scope.deferred_from_feature_id > 0))
}
export function validReleaseDiff(value: Diff, code: string, query: { beforeRecordId: number, afterRecordId: number, page: number, pageSize: number }): boolean {
  if (!value || value.product_code !== code || value.before_record_id !== query.beforeRecordId || value.after_record_id !== query.afterRecordId || value.page !== query.page || value.pageSize !== query.pageSize || ![value.total, value.added, value.removed, value.changed, value.unchanged].every(n => Number.isSafeInteger(n) && n >= 0) || value.total !== value.added + value.removed + value.changed || ![value.before_content_hash, value.after_content_hash].every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) || !Array.isArray(value.changes) || value.changes.length !== Math.min(query.pageSize, Math.max(0, value.total - (query.page - 1) * query.pageSize))) return false
  const counts = { added: 0, removed: 0, changed: 0 }
  let previous = 0
  for (const change of value.changes) {
    if (!change || !Number.isSafeInteger(change.scope_id) || change.scope_id <= previous) return false
    previous = change.scope_id
    if (change.kind === 'added' ? change.before !== null || !validReleaseScope(change.after, change.scope_id) : change.kind === 'removed' ? change.after !== null || !validReleaseScope(change.before, change.scope_id) : change.kind === 'changed' ? !validReleaseScope(change.before, change.scope_id) || !validReleaseScope(change.after, change.scope_id) : true) return false
    counts[change.kind as keyof typeof counts]++
  }
  for (const kind of ['added', 'removed', 'changed'] as const) {
    if (counts[kind] > value[kind] || (value.total === value.changes.length && counts[kind] !== value[kind])) return false
  }
  return true
}
