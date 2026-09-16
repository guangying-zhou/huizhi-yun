import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

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

describe('Aims instance conflict explanation', () => {
  test('server helper loads scoped target facts from tenant-runtime and calls Console runtime', () => {
    const content = source('server/utils/aimsInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(content, /\/v1\/aims\/authorization\/instance-conflict-facts/)
    assert.match(content, /target_type: targetType/)
    assert.match(content, /scope: 'aims\.read'/)
    assert.match(content, /resourceCode: resolvedFacts\.resourceCode/)
    assert.match(content, /action,\n\s+includeBaseline/)
    assert.match(content, /actorUid: uid/)
  })

  test('local API route checks view permission for resolved facts before explanation', () => {
    const route = source('server/api/v1/authorization/instance-conflict-explain.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(route, /loadAimsInstanceConflictFacts/)
    assert.match(route, /requirePermission\(event, facts\.resourceCode, 'view'\)/)
    assert.match(route, /explainAimsInstanceConflicts/)
    assertBefore(route, 'const facts = await loadAimsInstanceConflictFacts', 'await requirePermission(event, facts.resourceCode, \'view\')')
    assertBefore(route, 'await requirePermission(event, facts.resourceCode, \'view\')', 'const result = await explainAimsInstanceConflicts')
    assert.match(middleware, /api\\\/v1\\\/authorization\\\/instance-conflict-explain/)
  })

  test('frontend exposes requirement review inline conflict explanation entry', () => {
    const page = source('app/pages/projects/[id]/requirements/index.vue')
    const composable = source('app/composables/useAimsInstanceConflictExplanation.ts')
    const modal = source('app/components/AimsInstanceConflictExplanationModal.vue')

    assert.match(page, /useAimsInstanceConflictExplanation/)
    assert.match(page, /targetType: 'requirement_review'/)
    assert.match(page, /action: 'approve'/)
    assert.match(page, /AimsInstanceConflictExplanationModal/)
    assert.match(composable, /\/api\/v1\/authorization\/instance-conflict-explain/)
    assert.match(composable, /isConflictLoading/)
    assert.match(modal, /职责冲突解释/)
    assert.match(modal, /submitter/)
    assert.match(modal, /reviewer/)
    assert.match(modal, /result\.explanation\.rules/)
  })
})
