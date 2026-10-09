import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must occur before ${right}`)
}

describe('Altoc legacy Account-named Directory compatibility routes', () => {
  test('require a Console-backed request session before using directory configuration or adapter credentials', () => {
    const guardedRoutes = [
      ['server/api/account/config-check.get.ts', 'requireAltocSessionUid(event)', 'const runtimeConfig'],
      ['server/api/account/departments.get.ts', 'requireAltocSessionUid(event)', 'fetchDirectoryApi'],
      ['server/api/account/projects/index.get.ts', 'requireAltocSessionUid(event)', 'fetchDirectoryApi'],
      ['server/api/account/user-departments.get.ts', 'requireCurrentAltocSessionUid(event, uid)', 'fetchUserDepartments(actorUid)'],
      ['server/api/account/users/[uid].get.ts', 'requireAltocSessionUid(event)', 'fetchDirectoryApi'],
      ['server/api/account/users/[uid]/projects.get.ts', 'requireCurrentAltocSessionUid(event, uid, \'无权查看其他用户的项目关系\')', 'fetchDirectoryApi'],
      ['server/api/account/users/batch.post.ts', 'requireAltocSessionUid(event)', 'readBody'],
      ['server/api/account/users/index.get.ts', 'requireAltocSessionUid(event)', 'fetchDirectoryApi']
    ] as const

    for (const [path, guard, operation] of guardedRoutes) {
      assertBefore(source(path), guard, operation)
    }

    const identity = source('server/utils/authIdentity.ts')
    assert.match(identity, /resolveConsoleAuthWithSessionBridge/)
    assert.match(identity, /event\.context\.consoleAuth = await resolveConsoleAuthWithSessionBridge\(event\)/)
    assert.doesNotMatch(identity, /accountApi|HZY_ACCOUNT_API/)
  })

  test('self-service department and project relationship reads bind a supplied UID to the session subject', () => {
    const departments = source('server/api/account/user-departments.get.ts')
    const projects = source('server/api/account/users/[uid]/projects.get.ts')

    assertBefore(departments, 'requireCurrentAltocSessionUid(event, uid)', 'fetchUserDepartments(actorUid)')
    assert.match(departments, /uid: actorUid/)
    assert.doesNotMatch(departments, /fetchUserDepartments\(uid\)/)
    assertBefore(projects, 'requireCurrentAltocSessionUid(event, uid, \'无权查看其他用户的项目关系\')', 'encodeURIComponent(actorUid)')
    assert.doesNotMatch(projects, /encodeURIComponent\(uid\)\/projects/)

    const identity = source('server/utils/authIdentity.ts')
    assert.match(identity, /targetUid && targetUid !== actorUid/)
  })
})
