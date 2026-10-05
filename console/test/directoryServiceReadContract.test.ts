import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('restricted directory service read contract', () => {
  test('authenticates and tenant-binds the caller before reading directory data', () => {
    const route = source('server/api/v1/console/service/directory/users/index.get.ts')
    const auth = route.indexOf('requireConsoleServiceActor')
    const binding = route.indexOf('actor.tenantCode !== binding.tenantId')
    const query = route.indexOf('const query = getQuery(event)')
    const read = route.indexOf('await listDirectoryUsers')

    assert.match(route, /'console:directory-users:read'/)
    assert.match(route, /requireBoundTargetApp: true/)
    assert.ok(auth >= 0 && auth < binding)
    assert.ok(binding < query && query < read)
  })

  test('returns sharing identity fields without administrative PII', () => {
    const route = source('server/api/v1/console/service/directory/users/index.get.ts')

    for (const field of ['uid', 'realName', 'displayName', 'avatar', 'deptCode', 'deptName', 'positionTitle']) {
      assert.match(route, new RegExp(`${field}: user\\.${field}`))
    }
    assert.doesNotMatch(route, /mobile(?:Tail4)?: user\.|email: user\./)
  })

  test('forwards bounded pagination so business BFFs can resolve names beyond the first runtime page', () => {
    const route = source('server/api/v1/console/service/directory/users/index.get.ts')
    const read = route.slice(route.indexOf('const result = await listDirectoryUsers'))

    assert.match(read, /page: queryText\(query\.page\)/)
    assert.match(read, /pageSize: queryText\(query\.pageSize \|\| query\.limit\)/)
    assert.match(read, /page: result\.page/)
    assert.match(read, /pageSize: result\.pageSize/)
  })

  test('batch and department sharing projections use the same exact endpoint and limited fields', () => {
    const route = source('server/api/v1/console/service/directory/users/index.get.ts')

    assert.match(route, /'console:directory-users:read'/)
    assert.match(route, /requireBoundTargetApp: true/)
    assert.match(route, /actor\.tenantCode !== binding\.tenantId/)
    assert.match(route, /batchDirectoryUsers/)
    assert.match(route, /listDirectoryUserDepartments/)
    assert.match(route, /projection\) === 'departments'/)
    assert.match(route, /projection\) === 'user-departments'/)
    assert.match(route, /sharingDepartment/)
    assert.match(route, /managerId: node\.managerId/)
    assert.match(route, /leaderId: node\.leaderId/)
    assert.doesNotMatch(route, /mobile(?:Tail4)?: user\.|email: user\./)
  })

  test('Codocs receives only the exact directory read capability', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.56-codocs-directory-user-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'codocs'/)
    assert.match(seed, /'console:directory-users',[\s\S]*?'read'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/users' AS `endpoint`/)
    assert.match(seed, /'console:directory-project-access'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/project-access'/)
    assert.doesNotMatch(seed, /directory_users["']?\s*,\s*["']?view/i)
  })

  test('People receives only the restricted directory sharing capability, not a Console UI role', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.79-people-directory-sharing-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'people'/)
    assert.match(seed, /'console:directory-users',[\s\S]*?'read'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/users'/)
    assert.doesNotMatch(seed, /console:directory_operator|directory_users["']?\s*,\s*["']?view/i)
  })

  test('Aims receives only the restricted directory sharing capability, not a Console UI role', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.80-aims-directory-sharing-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'aims'/)
    assert.match(seed, /'console:directory-users',[\s\S]*?'read'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/users'/)
    assert.doesNotMatch(seed, /console:directory_operator|directory_users["']?\s*,\s*["']?view/i)
  })

  test('Altoc receives only the restricted directory sharing capability, not a Console UI role', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.81-altoc-directory-sharing-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'altoc'/)
    assert.match(seed, /'console:directory-users',[\s\S]*?'read'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/users'/)
    assert.doesNotMatch(seed, /console:directory_operator|directory_users["']?\s*,\s*["']?view/i)
  })

  test('Workflow receives only the restricted directory sharing capability, not a Console UI role', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.96-workflow-directory-sharing-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'workflow'/)
    assert.match(seed, /sc\.`client_code` = 'workflow\.runtime'/)
    assert.match(seed, /sc\.`current_credential_id` IS NOT NULL/)
    assert.match(seed, /'console:directory-users',[\s\S]*?'read'/)
    assert.match(seed, /'console:directory-users:read'/)
    assert.match(seed, /'audience', 'console'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/directory\/users'/)
    assert.doesNotMatch(seed, /console:directory_operator|directory_users["']?\s*,\s*["']?view/i)
  })

  test('service directory paths bypass generic user-audience auth and self-verify exact scopes', () => {
    const middleware = source('../foundation/server/middleware/console-auth.ts')
    const projectAccess = source('server/api/v1/console/service/directory/project-access.get.ts')

    assert.match(middleware, /pathname\.startsWith\('\/api\/v1\/console\/service\/directory\/'\)/)
    assert.match(projectAccess, /'console:directory-project-access:read'/)
    assert.match(projectAccess, /requireBoundTargetApp: true/)
    assert.match(projectAccess, /actor\.tenantCode !== binding\.tenantId/)
    assert.match(projectAccess, /actorIsMember/)
    assert.match(projectAccess, /projection === 'projects'/)
    assert.match(projectAccess, /projection === 'user-projects'/)
    assert.match(projectAccess, /projection === 'project'/)
  })
})
