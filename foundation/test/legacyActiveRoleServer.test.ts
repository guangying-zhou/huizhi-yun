import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('Foundation server no longer exposes legacy active-role request parsing helpers', () => {
  assert.equal(existsSync(new URL('../server/utils/activeRole.ts', import.meta.url)), false)

  for (const file of [
    'server/api/user/applications.get.ts',
    'server/utils/platformBundleAuthorization.ts',
    'server/utils/applicationAuthorization.ts'
  ]) {
    const content = source(file)

    assert.doesNotMatch(content, /activeRolePermissionQuery/)
    assert.doesNotMatch(content, /resolveActiveRoleCode/)
    assert.doesNotMatch(content, /x-hzy-active-role/)
    assert.doesNotMatch(content, /hzy_active_role/)
    assert.doesNotMatch(content, /hzy_active_enterprise_role/)
    assert.doesNotMatch(content, /query\.activeRoleCode/)
    assert.doesNotMatch(content, /query\.roleCode/)
  }
})

test('Foundation client authorization snapshot no longer consumes legacy active-role selection', () => {
  const authorization = source('app/composables/useAuthorization.ts')
  const userMenu = source('app/components/UserMenu.vue')

  assert.doesNotMatch(authorization, /useActiveRole\(/)
  assert.doesNotMatch(authorization, /activeRoleCodeOverride/)
  assert.doesNotMatch(authorization, /options\.activeRoleCode/)
  assert.doesNotMatch(authorization, /requestedActiveRoleCode/)
  assert.doesNotMatch(authorization, /preferredActiveRoleCode/)
  assert.doesNotMatch(authorization, /setActiveRoleCode/)
  assert.doesNotMatch(authorization, /query:\s*\{[\s\S]*activeRoleCode/)
  assert.doesNotMatch(userMenu, /snapshot\.activeRoleCode\s*=/)
  assert.doesNotMatch(userMenu, /useActiveRole\(/)
  assert.doesNotMatch(userMenu, /setActiveRoleCode/)
  assert.doesNotMatch(userMenu, /hzy_active_enterprise_role/)
  assert.doesNotMatch(userMenu, /roleSwitchItems/)
  assert.doesNotMatch(userMenu, /switchActiveRole/)
  assert.doesNotMatch(userMenu, /currentRoleLabel/)
  assert.doesNotMatch(userMenu, /已选择企业角色/)
})
