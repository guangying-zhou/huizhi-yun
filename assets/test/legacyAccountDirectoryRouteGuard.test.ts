import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Assets legacy Account-named directory compatibility routes', () => {
  test('requires a verified session before reading local configuration or using the Console Directory adapter', () => {
    const sessionGuardedRoutes = [
      'server/api/account/config-check.get.ts',
      'server/api/account/departments.get.ts',
      'server/api/account/projects/index.get.ts',
      'server/api/account/users/[uid].get.ts',
      'server/api/account/users/batch.post.ts',
      'server/api/account/users/index.get.ts'
    ]

    for (const route of sessionGuardedRoutes) {
      const content = source(route)
      const guard = content.indexOf('await requireAssetsSessionUid(event)')
      const directoryCall = content.indexOf('fetchDirectoryApi')
      assert.notEqual(guard, -1, `${route} must require a verified request subject`)
      assert.ok(directoryCall === -1 || guard < directoryCall, `${route} must guard before its Console Directory call`)
    }
  })

  test('binds relationship reads to the verified current subject', () => {
    const departments = source('server/api/account/user-departments.get.ts')
    const projects = source('server/api/account/users/[uid]/projects.get.ts')
    const identity = source('server/utils/authIdentity.ts')

    assert.match(identity, /export async function requireAssetsSessionUid/)
    assert.match(identity, /await ensureAssetsConsoleAuth\(event\)/)
    assert.match(identity, /export async function requireCurrentAssetsSessionUid/)
    assert.match(departments, /const actorUid = await requireCurrentAssetsSessionUid\(event, uid\)/)
    assert.match(departments, /fetchUserDepartments\(actorUid\)/)
    assert.match(projects, /requireCurrentAssetsSessionUid\(event, uid, '无权查看其他用户的项目关系'\)/)
    assert.match(projects, /encodeURIComponent\(actorUid\)/)
  })

  test('does not retain legacy Account adapter or fallback references in the compatibility routes', () => {
    const accountRoutes = [
      'server/api/account/departments.get.ts',
      'server/api/account/projects/index.get.ts',
      'server/api/account/user-departments.get.ts',
      'server/api/account/users/[uid].get.ts',
      'server/api/account/users/[uid]/projects.get.ts',
      'server/api/account/users/batch.post.ts',
      'server/api/account/users/index.get.ts'
    ]

    for (const route of accountRoutes) {
      assert.doesNotMatch(source(route), /accountApi|HZY_ACCOUNT|fetchAccount/i, `${route} must not fall back to Account`)
    }
  })
})
