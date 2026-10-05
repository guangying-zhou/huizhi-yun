import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenDepartmentTree } from '../shared/utils/consoleDepartmentTree.ts'
import type { ConsoleDirectoryDepartment } from '../app/types/consoleDirectory.ts'

test('shared department tree preserves expand, indentation and ancestor search matches', () => {
  const child = { deptCode: 'D2', name: '研发', manager: '员工', children: [] } as unknown as ConsoleDirectoryDepartment
  const root = { deptCode: 'D1', name: '公司', children: [child] } as unknown as ConsoleDirectoryDepartment
  assert.deepEqual(flattenDepartmentTree([root], '', new Set()).map(item => item.deptCode), ['D1'])
  assert.deepEqual(flattenDepartmentTree([root], '', new Set(['D1'])).map(item => [item.deptCode, item.displayLevel]), [['D1', 0], ['D2', 1]])
  assert.deepEqual(flattenDepartmentTree([root], '员工', new Set()).map(item => item.deptCode), ['D1', 'D2'])
  assert.equal(flattenDepartmentTree([root], '不存在', new Set()).length, 0)
})
