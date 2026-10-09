import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const workspace = resolve(root, '..')

async function source(path: string) {
  return await readFile(resolve(root, path), 'utf8')
}

describe('Console Directory tenant-runtime migration', () => {
  it('routes core management reads through the Foundation Runtime client after local authorization', async () => {
    const routes = [
      ['server/api/v1/console/directory/meta.get.ts', 'getConsoleDirectoryMeta', 'console_overview', 'view'],
      ['server/api/v1/console/directory/users/index.get.ts', 'getConsoleDirectoryUsers', 'directory_users', 'view'],
      ['server/api/v1/console/directory/users/[uid].get.ts', 'getConsoleDirectoryUser', 'directory_users', 'view'],
      ['server/api/v1/console/directory/users/[uid]/projects.get.ts', 'getConsoleDirectoryUserProjects', 'directory_users', 'view'],
      ['server/api/v1/console/directory/users/batch.post.ts', 'getConsoleDirectoryUsersBatch', 'directory_users', 'view'],
      ['server/api/v1/console/directory/user-departments.get.ts', 'getConsoleDirectoryUserDepartments', 'directory_users', 'view'],
      ['server/api/v1/console/directory/departments/index.get.ts', 'getConsoleDirectoryDepartments', 'directory_departments', 'view'],
      ['server/api/v1/console/directory/departments/[deptCode].get.ts', 'getConsoleDirectoryDepartment', 'directory_departments', 'view'],
      ['server/api/v1/console/directory/departments/[deptCode]/members.get.ts', 'getConsoleDirectoryDepartmentMembers', 'directory_departments', 'view'],
      ['server/api/v1/console/directory/committees/index.get.ts', 'getConsoleDirectoryCommittees', 'directory_departments', 'view'],
      ['server/api/v1/console/directory/committees/[committeeCode]/members/index.get.ts', 'getConsoleDirectoryCommitteeMembers', 'directory_departments', 'view'],
      ['server/api/v1/console/directory/projects/index.get.ts', 'getConsoleDirectoryProjects', 'directory_projects', 'view'],
      ['server/api/v1/console/directory/projects/[projectCode].get.ts', 'getConsoleDirectoryProject', 'directory_projects', 'view'],
      ['server/api/v1/console/directory/projects/members.get.ts', 'getConsoleDirectoryProjectMembers', 'directory_projects', 'view'],
      ['server/api/v1/console/directory/subjects/export.get.ts', 'getConsoleDirectorySubjectExports', 'directory_sync', 'export']
    ] as const

    for (const [path, helper, resource, action] of routes) {
      const content = await source(path)
      assert.match(content, new RegExp(`requirePermission\\(event, '${resource}', '${action}'`))
      assert.match(content, new RegExp(`${helper}\\(event`))
      assert.doesNotMatch(content, /directoryRuntime|queryRows|queryRow|server\/utils\/db/)
    }
  })

  it('freezes exact Runtime paths, capabilities and the bounded page contract', async () => {
    const client = await readFile(
      resolve(workspace, 'foundation/server/utils/consoleTenantRuntimeClient.ts'),
      'utf8'
    )
    const runtime = await readFile(
      resolve(workspace, 'data-runtime/internal/apps/directory/console_management.go'),
      'utf8'
    )
    const identity = await readFile(
      resolve(workspace, 'data-runtime/internal/apps/console/auth_service_tokens.go'),
      'utf8'
    )

    for (const path of [
      '/v1/console/directory/meta',
      '/v1/console/directory/users',
      '/v1/console/directory/departments',
      '/v1/console/directory/committees',
      '/v1/console/directory/projects',
      '/v1/console/directory/subjects/export',
      '/v1/console/directory/subjects/memberships'
    ]) {
      assert.match(client, new RegExp(path.replaceAll('/', '\\/')))
    }
    for (const capability of [
      'console:directory-user:view',
      'console:directory-department:view',
      'console:directory-project:view',
      'console:directory-sync:export'
    ]) {
      assert.ok(client.includes(capability))
      assert.ok(identity.includes(capability))
    }
    assert.match(runtime, /pageSize > 100/)
    assert.match(runtime, /directory_page_size_too_large/)
    assert.doesNotMatch(runtime, /pageSize.*500|fallback.*500/)
  })

  it('keeps legacy aliases on the Runtime-only compatibility repository', async () => {
    const repository = await source('server/utils/directoryRuntime.ts')
    assert.match(repository, /getConsoleDirectoryUsers/)
    assert.match(repository, /getConsoleDirectorySubjectMemberships/)
    assert.match(repository, /useEvent\(\)/)
    assert.doesNotMatch(repository, /server\/utils\/db|queryRows|queryRow|withTransaction/)
  })
})
