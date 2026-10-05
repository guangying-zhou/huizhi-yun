import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const route = readFileSync(new URL('../server/api/account/users/index.get.ts', import.meta.url), 'utf8')
const batchRoute = readFileSync(new URL('../server/api/account/users/batch.post.ts', import.meta.url), 'utf8')
const departmentsRoute = readFileSync(new URL('../server/api/account/departments.get.ts', import.meta.url), 'utf8')
const userDepartmentsRoute = readFileSync(new URL('../server/api/account/user-departments.get.ts', import.meta.url), 'utf8')
const projectsRoute = readFileSync(new URL('../server/api/account/projects/index.get.ts', import.meta.url), 'utf8')
const projectRoute = readFileSync(new URL('../server/api/account/projects/[...projectCode].get.ts', import.meta.url), 'utf8')
const userProjectsRoute = readFileSync(new URL('../server/api/account/users/[uid]/projects.get.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('../server/utils/directoryService.ts', import.meta.url), 'utf8')
const currentUser = readFileSync(new URL('../server/api/account/user.ts', import.meta.url), 'utf8')
const issueAccess = readFileSync(new URL('../server/utils/issueProjectAccess.ts', import.meta.url), 'utf8')

test('Codocs user picker uses its exact Console service capability after session authentication', () => {
  const session = route.indexOf('requireRequestUid(event)')
  const request = route.indexOf('await fetchDirectoryUsersByService')

  assert.ok(session >= 0 && session < request)
  assert.match(service, /audience: 'console'/)
  assert.match(service, /scope: 'console:directory-users:read'/)
  assert.match(service, /\/api\/v1\/console\/service\/directory\/users/)
  assert.match(service, /requestWithServiceAccessToken/)
  assert.match(service, /trustedServiceRequestHeaders\(event\)/)
  assert.doesNotMatch(route, /fetchDirectoryResponse|headers:\s*\{[^}]*cookie/i)
  assert.match(batchRoute, /requireRequestUid\(event\)/)
  assert.match(batchRoute, /fetchDirectoryUsersBatchByService\(event, body\.uids\)/)
  assert.doesNotMatch(batchRoute, /fetchDirectoryResponse|headers:\s*\{[^}]*cookie/i)
  assert.match(service, /params: \{ uids: uids\.join\(','\) \}/)
  assert.match(departmentsRoute, /fetchDirectoryDepartmentsByService\(event\)/)
  assert.doesNotMatch(departmentsRoute, /fetchDirectoryResponse|headers:\s*\{[^}]*cookie/i)
  assert.match(service, /params: \{ projection: 'departments' \}/)
  assert.match(userDepartmentsRoute, /fetchUserDepartments\(event, actorUid\)/)
  assert.match(service, /params: \{ projection: 'user-departments', uid \}/)
  assert.doesNotMatch(userDepartmentsRoute, /fetchDirectoryResponse|headers:\s*\{[^}]*cookie/i)
})

test('project menus use the exact project-access service capability', () => {
  assert.match(projectsRoute, /fetchDirectoryProjectsByService\(event/)
  assert.match(projectRoute, /fetchDirectoryProjectByService\(event, projectCode\)/)
  assert.match(userProjectsRoute, /fetchDirectoryUserProjectsByService\(event, uid/)
  assert.match(service, /scope: 'console:directory-project-access:read'/)
  assert.match(service, /projection: 'projects'/)
  assert.match(service, /projection: 'user-projects'/)
  assert.match(service, /projection: 'project'/)
  for (const route of [projectsRoute, projectRoute, userProjectsRoute]) {
    assert.doesNotMatch(route, /fetchDirectoryResponse|headers:\s*\{[^}]*cookie/i)
  }
})

test('current-user profile and issue project scope no longer call anonymous admin directory APIs', () => {
  assert.match(currentUser, /requireCurrentRequestUid/)
  assert.match(currentUser, /fetchDirectoryUsersByService/)
  assert.doesNotMatch(currentUser, /fetchDirectoryUser(?:<|\()/)

  assert.match(issueAccess, /fetchDirectoryProjectAccessByService/)
  assert.match(service, /scope: 'console:directory-project-access:read'/)
  assert.doesNotMatch(issueAccess, /fetchDirectoryResponse/)
})
