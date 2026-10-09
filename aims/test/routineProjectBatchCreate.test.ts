import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('department routine project batch creation', () => {
  test('project management UI submits only the selected year', () => {
    const page = source('app/pages/admin/projects.vue')

    assert.match(page, /label="批量创建部门事务项目"/)
    assert.match(page, /v-if="canBatchCreateRoutineProjects"/)
    assert.match(page, /hasPermission\('admin', 'admin'\)/)
    assert.match(page, /v-model\.number="routineBatchYear"/)
    assert.match(page, /body: \{ year: Number\(routineBatchYear\.value\) \}/)
    assert.doesNotMatch(page, /body: \{ year: Number\(routineBatchYear\.value\),\s*departments:/)
  })

  test('Aims BFF derives departments, managers and members from Console Directory', () => {
    const handler = source('server/api/v1/admin/projects/batch-create-routine.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    const permissionIndex = handler.indexOf('await requireAimsAdminRoleAccess')
    const bodyIndex = handler.indexOf('await readBody')
    const directoryIndex = handler.indexOf('const departmentResponse = await fetchConsoleDirectoryApi')
    const runtimeIndex = handler.indexOf('/v1/aims/admin/projects/batch-create-routine')
    assert.ok(permissionIndex >= 0 && permissionIndex < bodyIndex)
    assert.ok(bodyIndex >= 0 && bodyIndex < directoryIndex && directoryIndex < runtimeIndex)
    assert.match(handler, /fetchConsoleDirectoryApi<[^]*>\('\/departments'/)
    assert.match(handler, /fetchConsoleDirectoryApi<[^]*>\('\/users'/)
    assert.match(handler, /dept_code: deptCode/)
    assert.match(handler, /managerUid: department\.managerId/)
    assert.match(handler, /memberUids: department\.managerId/)
    assert.match(handler, /current_user_is_project_admin: '1'/)
    assert.match(middleware, /admin\\\/projects\\\/batch-create-routine/)
  })

  test('data-runtime owns the transactional and idempotent write', () => {
    const runtime = source('../data-runtime/internal/apps/aims/routine_projects_batch.go')
    const workspace = source('../data-runtime/internal/apps/aims/workspace.go')

    assert.match(workspace, /handleRoutineProjectBatchRuntime/)
    assert.match(runtime, /BeginTx/)
    assert.match(runtime, /WHERE default_category = 'routine'/)
    assert.match(runtime, /INSERT INTO project_portfolios/)
    assert.match(runtime, /category = 'routine' AND dept_code = \? AND name = \?/)
    assert.match(runtime, /routineDepartmentProjectCode\(year, department\.DeptCode\)/)
    assert.match(runtime, /INSERT INTO aims_project_members/)
    assert.match(runtime, /roles\[managerUID\] = "manager"/)
    assert.match(runtime, /item\["reason"\] = "exists"/)
    assert.match(runtime, /item\["reason"\] = "missing_manager"/)
    assert.match(runtime, /tx\.Commit\(\)/)
  })
})
