import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('Foundation directory membership BFF routes verify a user session before using the Console adapter', () => {
  const routes = [
    'server/api/account/dept-members.get.ts',
    'server/api/account/user-departments.get.ts',
    'server/api/directory/departments/[deptCode]/members.get.ts',
    'server/api/directory/user-departments.get.ts'
  ]

  for (const route of routes) {
    const content = source(route)
    const guard = content.indexOf('await requireFoundationSessionUid(event)')
    const directoryCall = content.indexOf('fetchConsoleDirectoryApi(')

    assert.notEqual(guard, -1, `${route} must require a verified Console user session`)
    assert.notEqual(directoryCall, -1, `${route} must use the Console Directory adapter`)
    assert.ok(guard < directoryCall, `${route} must verify the session before a directory call`)
  }
})

test('Foundation session guard rejects anonymous and service identities', () => {
  const content = source('server/utils/authIdentity.ts')

  assert.match(content, /context\.subjectType !== 'user'/)
  assert.match(content, /await resolveConsoleAuthWithSessionBridge\(event\)/)
  assert.match(content, /statusCode: 401/)
})
