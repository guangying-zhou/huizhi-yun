import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('People instance conflict explanation', () => {
  test('server helper loads assignment facts from tenant-runtime and calls Console runtime', () => {
    const content = source('server/utils/peopleInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /\/v1\/people\/assignments\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'assignments'/)
    assert.match(content, /created_by/)
    assert.match(content, /employee_uid/)
    assert.match(content, /kind: 'operator'/)
    assert.match(content, /kind: 'employee'/)
  })

  test('local API route and middleware keep explanation as BFF orchestration', () => {
    const route = source('server/api/v1/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(route, /assertPeoplePermission\(event, 'assignments', 'view'\)/)
    assert.match(route, /explainPeopleInstanceConflicts/)
    assert.match(middleware, /isAllowedLocalApiV1Path\(pathname\)/)
    assert.match(middleware, /authorization\\\/instance-conflict-explain/)
    assert.match(middleware, /api\\\/v1\\\/authorization\\\/instance-conflict-explain/)
  })

  test('assignment page exposes an inline conflict explanation entry', () => {
    const content = source('app/pages/assignments.vue')

    assert.match(content, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(content, /targetType: 'assignment'/)
    assert.match(content, /#conflict_actions-cell/)
    assert.match(content, /任职变更审批风险解释/)
    assert.match(content, /employee/)
  })
})
