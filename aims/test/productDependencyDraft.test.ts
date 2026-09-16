import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeProductDependencyDraft } from '../app/utils/productDependencyDraft.ts'

const item = (biz_id: string, title = biz_id) => ({ biz_id, title })
test('dependency conflict refresh preserves concurrent additions and local removals', () => {
  const merged = mergeProductDependencyDraft([item('a'), item('b')], [item('b'), item('c')], [item('a'), item('b', 'updated'), item('d')])
  assert.deepEqual(merged, [item('b', 'updated'), item('d'), item('c')])
})
test('unchanged draft does not resurrect concurrent deletions or overwrite fresh metadata', () => {
  assert.deepEqual(mergeProductDependencyDraft([item('a')], [item('a'), item('b')], [item('b', 'fresh')]), [item('b', 'fresh')])
  assert.deepEqual(mergeProductDependencyDraft([item('a')], [], [item('a'), item('new')]), [item('new')])
})
test('conflict merge is atomic and refuses duplicate or oversized sets', () => {
  const original = [item('a')], draft = [item('local')], latest = Array.from({ length: 100 }, (_, i) => item(String(i)))
  assert.throws(() => mergeProductDependencyDraft(original, draft, latest))
  assert.equal(latest.length, 100)
  assert.deepEqual(draft, [item('local')])
  assert.throws(() => mergeProductDependencyDraft([], [item('a'), item('a')], []))
})
