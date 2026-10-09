import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { compareOpenDepartmentFolderNames, openDepartmentFolderIdSet, openDepartmentVisibleFolderMap } from '../server/utils/openDepartmentTree.ts'

describe('open department folder tree', () => {
  test('open parent folder includes all descendant subfolders', () => {
    const visible = openDepartmentFolderIdSet([
      { id: 1, parent_id: null, is_open: 1 },
      { id: 2, parent_id: 1, is_open: 0 },
      { id: 3, parent_id: 2, is_open: 0 },
      { id: 4, parent_id: null, is_open: 0 }
    ])

    assert.deepEqual([...visible].sort((a, b) => a - b), [1, 2, 3])
  })

  test('open subfolder includes its descendants without exposing closed ancestors', () => {
    const visible = openDepartmentFolderIdSet([
      { id: 1, parent_id: null, is_open: 0 },
      { id: 2, parent_id: 1, is_open: true },
      { id: 3, parent_id: 2, is_open: '1' },
      { id: 4, parent_id: 3, is_open: false }
    ])

    assert.deepEqual([...visible].sort((a, b) => a - b), [2, 3, 4])
  })

  test('visible folder map preserves folder metadata for descendant validation', () => {
    const visible = openDepartmentVisibleFolderMap([
      { id: 1, parent_id: null, dept_code: 'D1', is_open: false },
      { id: 2, parent_id: 1, dept_code: 'D1', is_open: true },
      { id: 3, parent_id: 2, dept_code: 'D1', is_open: false },
      { id: 4, parent_id: null, dept_code: 'D2', is_open: false }
    ])

    assert.deepEqual([...visible.keys()].sort((a, b) => a - b), [2, 3])
    assert.equal(visible.get(3)?.dept_code, 'D1')
    assert.equal(visible.has(1), false)
    assert.equal(visible.has(4), false)
  })

  test('open department folders sort by name before sort order', () => {
    const folders = [
      { id: 1, name: '研发资料', sort_order: 1 },
      { id: 2, name: '财务制度', sort_order: 99 },
      { id: 3, name: '行政规范', sort_order: 2 },
      { id: 4, name: '行政规范', sort_order: 1 }
    ].sort(compareOpenDepartmentFolderNames)

    assert.deepEqual(folders.map(folder => folder.id), [2, 4, 3, 1])
  })
})
