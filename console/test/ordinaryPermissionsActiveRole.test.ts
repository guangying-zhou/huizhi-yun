import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console ordinary permission snapshots ignore legacy active-role selectors', () => {
  test('session permission endpoint does not forward query simulation mode', () => {
    const content = source('server/api/auth/permissions.get.ts')
    const callBlock = content.slice(
      content.indexOf('const snapshot = await loadPolicyAuthorizationSnapshot'),
      content.indexOf('return {', content.indexOf('const snapshot = await loadPolicyAuthorizationSnapshot'))
    )

    assert.match(callBlock, /loadPolicyAuthorizationSnapshot\(uid, targetAppCode, event\)/)
    assert.doesNotMatch(content, /query\.authorizationMode/)
    assert.doesNotMatch(callBlock, /authorizationMode/)
    assert.doesNotMatch(callBlock, /activeRoleCode/)
  })

  test('bearer permission endpoint does not forward query simulation mode', () => {
    const content = source('server/api/v1/console/user/permissions.get.ts')
    const callBlock = content.slice(
      content.indexOf('const snapshot = await loadPolicyAuthorizationSnapshot'),
      content.indexOf('await writeTokenEvent', content.indexOf('const snapshot = await loadPolicyAuthorizationSnapshot'))
    )

    assert.match(callBlock, /loadPolicyAuthorizationSnapshot\(uid, targetAppCode, event\)/)
    assert.doesNotMatch(content, /query\.authorizationMode/)
    assert.doesNotMatch(callBlock, /authorizationMode/)
    assert.doesNotMatch(callBlock, /activeRoleCode/)
  })

  test('policy authorization has no ordinary query, header, or cookie active-role resolver', () => {
    const content = source('server/utils/policyAuthorization.ts')

    assert.doesNotMatch(content, /resolveRequestedActiveRoleCode/)
    assert.doesNotMatch(content, /x-hzy-active-role/)
    assert.doesNotMatch(content, /hzy_active_role/)
    assert.doesNotMatch(content, /hzy_active_enterprise_role/)
    assert.doesNotMatch(content, /query\.activeRoleCode/)
    assert.doesNotMatch(content, /query\.roleCode/)
    assert.doesNotMatch(content, /getCookie\(event/)
    assert.doesNotMatch(content, /getHeader\(event, 'x-hzy-active-role'\)/)
  })

  test('explicit scoped and instance explain APIs remain simulation-capable', () => {
    for (const file of [
      'server/api/auth/scoped-authorization.post.ts',
      'server/api/v1/console/user/scoped-authorization.post.ts',
      'server/api/auth/instance-conflict-explain.post.ts',
      'server/api/v1/console/user/instance-conflict-explain.post.ts'
    ]) {
      const content = source(file)
      assert.match(content, /activeRoleCode/)
      assert.match(content, /authorizationMode/)
    }
  })
})
