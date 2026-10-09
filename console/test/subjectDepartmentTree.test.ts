import test from 'node:test'
import assert from 'node:assert/strict'
import { subjectDepartmentTreeIndex } from '../server/utils/subjectDepartmentTree.ts'

test('department scope expansion includes descendants without nondepartment relations', () => {
  const index = subjectDepartmentTreeIndex([
    { deptCode: 'D2', parentId: 'D1', orgType: 'department' },
    { deptCode: 'D1', parentId: null, orgType: 'department' },
    { deptCode: 'C1', parentId: 'D1', orgType: 'committee' },
    { deptCode: 'D3', parentId: 'D2', orgType: 'department' }
  ])
  assert.deepEqual(index.D1, ['D1', 'D2', 'D3'])
  assert.deepEqual(index.D2, ['D2', 'D3'])
  assert.equal(index.C1, undefined)
  assert.throws(() => subjectDepartmentTreeIndex([{ deptCode: 'D1', parentId: 'D1', orgType: 'department' }]))
  assert.throws(() => subjectDepartmentTreeIndex(null))
})
