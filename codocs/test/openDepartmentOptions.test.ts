import test from 'node:test'
import assert from 'node:assert/strict'
import { openDepartmentOptions, openDepartmentSelection } from '../app/utils/openDepartmentOptions'

test('departments without open contents remain selectable without falling back to another department', () => {
  const directory = [{ deptCode: 'D1', name: '研发' }, { deptCode: 'D2', name: '设计' }]
  const groups = [{ deptCode: 'D1', deptName: 'D1', documentCount: 1, folders: [{ id: 1 }] }]
  const options = openDepartmentOptions(directory, groups)
  assert.deepEqual(options, [{ value: 'D1', label: '研发' }, { value: 'D2', label: '设计' }])
  assert.deepEqual(openDepartmentSelection('D2', options, groups), { deptCode: 'D2', deptName: '设计', documentCount: 0, folders: [] })
  assert.equal(openDepartmentSelection('D1', options, groups), groups[0])
  assert.equal(openDepartmentSelection('unknown', options, groups), null)
})

test('an authorized open directory retains its code when the directory projection lacks its label', () => {
  assert.deepEqual(openDepartmentOptions([], [{ deptCode: 'D3', deptName: '开放部门' }]), [{ value: 'D3', label: '开放部门' }])
})
