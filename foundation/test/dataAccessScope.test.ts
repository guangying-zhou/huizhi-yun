import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeScopedDataAccess } from '../server/utils/dataAccessScope.ts'

test('已认证且有权限的用户在范围无法解析时降级为 self，而非 none（防 403 回归）', () => {
  assert.deepEqual(
    finalizeScopedDataAccess({ sawPermission: true, allowSelf: false, deptCodes: [] }),
    { access: 'self', deptCodes: [] }
  )
})

test('解析到 self 范围时返回 self', () => {
  assert.deepEqual(
    finalizeScopedDataAccess({ sawPermission: true, allowSelf: true, deptCodes: [] }),
    { access: 'self', deptCodes: [] }
  )
})

test('解析到部门范围时返回 dept 并去重部门编码', () => {
  assert.deepEqual(
    finalizeScopedDataAccess({ sawPermission: true, allowSelf: false, deptCodes: ['d1', 'd1', 'd2'] }),
    { access: 'dept', deptCodes: ['d1', 'd2'] }
  )
})

test('部门范围优先于 self', () => {
  assert.deepEqual(
    finalizeScopedDataAccess({ sawPermission: true, allowSelf: true, deptCodes: ['d1'] }),
    { access: 'dept', deptCodes: ['d1'] }
  )
})

test('未命中任何权限的用户返回 none', () => {
  assert.deepEqual(
    finalizeScopedDataAccess({ sawPermission: false, allowSelf: false, deptCodes: [] }),
    { access: 'none', deptCodes: [] }
  )
})
