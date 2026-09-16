import test from 'node:test'
import assert from 'node:assert/strict'
import { validReleaseDiff, type Diff, type Scope } from '../app/utils/productReleaseDiff'
const scope: Scope = { id: 1, title: '范围', description: null, status: 'delivered', acceptance_criteria: null, product_feature_biz_id: null, planning_item_biz_id: null, change_type: null, category: null, is_public: false, sort_order: 0, legacy_unscored: true, deferred_from_feature_id: null }
const query = { beforeRecordId: 1, afterRecordId: 2, page: 1, pageSize: 20 }
const value: Diff = { product_code: 'P', before_record_id: 1, after_record_id: 2, before_content_hash: 'a'.repeat(64), after_content_hash: 'b'.repeat(64), added: 1, removed: 0, changed: 0, unchanged: 0, total: 1, page: 1, pageSize: 20, changes: [{ scope_id: 1, kind: 'added', before: null, after: scope }] }
test('release comparison rejects incomplete pages, unsafe links and malformed frozen fields', () => {
  assert.equal(validReleaseDiff(value, 'P', query), true)
  for (const change of [{ ...scope, is_public: undefined }, { ...scope, status: 'unknown' }, { ...scope, planning_item_biz_id: '../../other' }]) assert.equal(validReleaseDiff({ ...value, changes: [{ ...value.changes[0]!, after: change as Scope }] }, 'P', query), false)
  assert.equal(validReleaseDiff({ ...value, changes: [] }, 'P', query), false)
  assert.equal(validReleaseDiff({ ...value, total: 2, added: 2, changes: [value.changes[0]!, value.changes[0]!] }, 'P', query), false)
  assert.equal(validReleaseDiff({ ...value, page: 2, changes: [] }, 'P', { ...query, page: 2 }), true)
})

test('release comparison reconciles page kinds without mistaking a page for global totals', () => {
  assert.equal(validReleaseDiff({ ...value, added: 0, removed: 1 }, 'P', query), false)
  assert.equal(validReleaseDiff({ ...value, pageSize: 1, total: 2, added: 1, changed: 1 }, 'P', { ...query, pageSize: 1 }), true)
  const removed = { scope_id: 2, kind: 'removed', before: { ...scope, id: 2 }, after: null }
  assert.equal(validReleaseDiff({ ...value, pageSize: 1, page: 2, total: 2, added: 1, removed: 1, changes: [removed] }, 'P', { ...query, pageSize: 1, page: 2 }), true)
})
