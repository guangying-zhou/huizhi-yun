import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isActiveDirectoryUser } from '../shared/utils/directoryUserStatus.ts'

test('member eligibility uses Directory active facts, not missing/deleted/pending status', () => {
  for (const status of [0, -1, 'inactive', 'deleted', 'pending', undefined, null, true]) {
    assert.equal(isActiveDirectoryUser(status), false)
  }
  assert.equal(isActiveDirectoryUser(1), true)
  assert.equal(isActiveDirectoryUser('active'), true)
  const source = readFileSync(new URL('../app/components/UserTreeSelector.vue', import.meta.url), 'utf8')
  assert.match(source, /if \(!isActiveDirectoryUser\(u.status\)\) continue/)
  assert.match(source, /账号已停用、授权不生效/)
})
