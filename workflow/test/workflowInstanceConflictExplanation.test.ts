import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, first: string, second: string) {
  const firstIndex = content.indexOf(first)
  const secondIndex = content.indexOf(second)
  assert.notEqual(firstIndex, -1, `missing ${first}`)
  assert.notEqual(secondIndex, -1, `missing ${second}`)
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`)
}

describe('Workflow instance conflict explanation', () => {
  test('server helper derives task facts from tenant-runtime and calls Console runtime', () => {
    const content = source('server/utils/workflowInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallWorkflowDataRuntime/)
    assert.match(content, /\/v1\/workflow\/tasks\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /scope: 'workflow\.read'/)
    assert.match(content, /current_user: uid/)
    assert.match(content, /resourceCode: 'workflow_tasks'/)
    assert.match(content, /actorUid: uid/)
    assert.match(content, /initiator_uid/)
    assert.match(content, /assignee_uid/)
    assert.doesNotMatch(content, /server\/utils\/db/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /queryRows/)
  })

  test('local API route is view-guarded before runtime fact loading and explanation', () => {
    const route = source('server/api/v1/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/data-runtime.ts')

    assert.match(route, /requirePermission\(event, 'workflow_tasks', 'view'\)/)
    assert.match(route, /loadWorkflowTaskConflictDetail/)
    assert.match(route, /explainWorkflowInstanceConflicts/)
    assertBefore(
      route,
      'await requirePermission(event, \'workflow_tasks\', \'view\')',
      'const detail = await loadWorkflowTaskConflictDetail'
    )
    assertBefore(
      route,
      'const detail = await loadWorkflowTaskConflictDetail',
      'const result = await explainWorkflowInstanceConflicts'
    )
    assert.doesNotMatch(middleware, /authorization\/instance-conflict-explain/)
  })

  test('task detail page exposes inline conflict explanation for approval tasks', () => {
    const page = source('app/pages/tasks/[id].vue')

    assert.match(page, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(page, /openConflictExplanation\('approve'\)/)
    assert.match(page, /i-lucide-shield-question/)
    assert.match(page, /职责冲突解释/)
    assert.match(page, /conflictResult\.explanation\.rules/)
    assert.match(page, /conflictPrincipalLabel/)
    assert.match(page, /当前审批任务未命中 active 职责冲突规则/)
  })

  test('module docs describe the tenant-runtime backed conflict explanation API', () => {
    const readme = source('README.md')
    const design = source('docs/workflow_design.md')

    for (const content of [readme, design]) {
      assert.match(content, /\/api\/v1\/authorization\/instance-conflict-explain|\/authorization\/instance-conflict-explain/)
      assert.match(content, /workflow_tasks:view/)
      assert.match(content, /tenant-runtime/)
      assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
      assert.match(content, /initiator_uid/)
      assert.match(content, /assignee_uid/)
    }
  })
})
