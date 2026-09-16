import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getBuiltinDirectoryUser,
  splitBuiltinDirectoryUids
} from '../server/utils/builtinDirectoryUsers.ts'

test('内置目录身份：system 在本地解析，不转发 Console Directory', () => {
  const user = getBuiltinDirectoryUser('system')

  assert.equal(user?.uid, 'system')
  assert.equal(user?.realName, '系统')
})

test('内置目录身份：批量解析拆分 system 和真实用户 uid', () => {
  const result = splitBuiltinDirectoryUids(['system', 'u1', 'system', '', 'u2'])

  assert.deepEqual(result.builtinUsers.map(user => user.uid), ['system'])
  assert.deepEqual(result.externalUids, ['u1', 'u2'])
})
