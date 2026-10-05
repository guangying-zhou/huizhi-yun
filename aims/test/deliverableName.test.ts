import assert from 'node:assert/strict'
import test from 'node:test'
import { hasDuplicateDeliverableName, normalizeDeliverableName } from '../app/utils/deliverableName.ts'

test('deliverable names ignore surrounding whitespace and case', () => {
  assert.equal(normalizeDeliverableName('  Release Notes  '), 'release notes')
  assert.equal(hasDuplicateDeliverableName([
    { id: 207, name: '《需求规格说明书》' },
    { id: 208, name: 'Release Notes' }
  ], ' 《需求规格说明书》 '), true)
  assert.equal(hasDuplicateDeliverableName([
    { id: 208, name: 'Release Notes' }
  ], 'release notes'), true)
})

test('editing excludes the current deliverable but still detects another row', () => {
  const items = [
    { id: 207, name: '《需求规格说明书》' },
    { id: 214, name: '其他成果' }
  ]
  assert.equal(hasDuplicateDeliverableName(items, '《需求规格说明书》', 207), false)
  assert.equal(hasDuplicateDeliverableName(items, '《需求规格说明书》', 214), true)
})
