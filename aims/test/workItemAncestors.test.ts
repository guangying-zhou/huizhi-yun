import assert from 'node:assert/strict'
import test from 'node:test'
import { workItemAncestorPath } from '../app/utils/workItemAncestors'

test('paged work item preserves a full ancestor path outside its current page', () => {
  const closure = [
    { id: 1, parentId: null, itemKey: 'ROOT-1', title: 'Root' },
    { id: 2, parentId: 1, itemKey: 'PARENT-2', title: 'Parent' }
  ]
  assert.equal(workItemAncestorPath(2, closure), 'ROOT-1 / PARENT-2')
  assert.equal(workItemAncestorPath(null, closure), '')
  assert.equal(workItemAncestorPath(999, closure), '')
})
