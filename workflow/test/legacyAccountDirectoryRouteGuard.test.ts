import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, guard: string, operation: string) {
  const guardIndex = content.indexOf(guard)
  const operationIndex = content.indexOf(operation)
  assert.notEqual(guardIndex, -1, `Missing ${guard}`)
  assert.notEqual(operationIndex, -1, `Missing ${operation}`)
  assert.ok(guardIndex < operationIndex, `${guard} must occur before ${operation}`)
}

describe('Workflow legacy Account-named Directory compatibility routes', () => {
  test('requires a Console-backed session before configuration, request body, or Directory adapter access', () => {
    const guardedRoutes = [
      ['server/api/account/config-check.get.ts', 'requireWorkflowSessionUid(event)', 'getDirectoryConfig()'],
      ['server/api/account/departments.get.ts', 'requireWorkflowSessionUid(event)', 'return await fetchDirectoryApi'],
      ['server/api/account/users/[uid].get.ts', 'requireWorkflowSessionUid(event)', 'return await fetchDirectoryApi'],
      ['server/api/account/users/batch.post.ts', 'requireWorkflowSessionUid(event)', 'const body = await readBody(event)'],
      ['server/api/account/users/index.get.ts', 'requireWorkflowSessionUid(event)', 'return await fetchDirectoryApi']
    ] as const

    for (const [path, guard, operation] of guardedRoutes) {
      assertBefore(source(path), guard, operation)
    }

    const identity = source('server/utils/authIdentity.ts')
    assert.match(identity, /export async function requireWorkflowSessionUid/)
    assert.match(identity, /await ensureWorkflowConsoleAuth\(event\)/)
  })

  test('binds user-department relationship reads to the verified current subject', () => {
    const departments = source('server/api/account/user-departments.get.ts')
    const identity = source('server/utils/authIdentity.ts')

    assertBefore(departments, 'requireCurrentWorkflowSessionUid(event, uid)', 'fetchUserDepartments(actorUid)')
    assert.match(departments, /data: \{ uid: actorUid, departments, primaryDeptCode \}/)
    assert.doesNotMatch(departments, /fetchUserDepartments\(uid\)/)
    assert.match(identity, /export async function requireCurrentWorkflowSessionUid/)
    assert.match(identity, /targetUid && targetUid !== actorUid/)
  })

  test('does not retain a legacy Account adapter or fallback in compatibility routes', () => {
    const accountRoutes = [
      'server/api/account/config-check.get.ts',
      'server/api/account/departments.get.ts',
      'server/api/account/user-departments.get.ts',
      'server/api/account/users/[uid].get.ts',
      'server/api/account/users/batch.post.ts',
      'server/api/account/users/index.get.ts'
    ]

    for (const route of accountRoutes) {
      assert.doesNotMatch(source(route), /accountApi|HZY_ACCOUNT|fetchAccount/i, `${route} must not fall back to Account`)
    }
  })
})
