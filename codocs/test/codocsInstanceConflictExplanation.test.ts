import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Codocs instance conflict explanation', () => {
  test('server helper derives review facts and delegates explanation to Foundation', () => {
    const content = source('server/utils/codocsInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /maybeCallCodocsTenantRuntime<Record<string, unknown>>/)
    assert.match(content, /\/v1\/codocs\/reviews\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode:\s*'reviews'/)
    assert.match(content, /action === 'approve' \|\| action === 'archive'/)
    assert.match(content, /kind:\s*'initiator'/)
    assert.match(content, /kind:\s*'submitter'/)
    assert.doesNotMatch(content, /kind:\s*'reviewer'/)
  })

  test('API route requires review visibility before explaining conflicts', () => {
    const content = source('server/api/reviews/authorization/instance-conflict-explain.post.ts')

    assert.match(content, /requirePermission\(event,\s*'reviews',\s*'view'/)
    assert.match(content, /explainCodocsInstanceConflicts\(event/)
  })

  test('tenant runtime middleware allows the local BFF explanation route', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /apiPath === '\/api\/reviews\/authorization\/instance-conflict-explain' && method === 'POST'/)
  })

  test('review detail page exposes approve and archive conflict explanation entry points', () => {
    const content = source('app/pages/reviews/[id].vue')

    assert.match(content, /useCodocsInstanceConflictExplanation\(\)/)
    assert.match(content, /CodocsInstanceConflictExplanationModal/)
    assert.match(content, /targetType:\s*'review'/)
    assert.match(content, /openReviewConflictExplanation\('approve'\)/)
    assert.match(content, /openReviewConflictExplanation\('archive'\)/)
  })

  test('composable posts to the Codocs review explanation endpoint', () => {
    const content = source('app/composables/useCodocsInstanceConflictExplanation.ts')

    assert.match(content, /\/api\/reviews\/authorization\/instance-conflict-explain/)
    assert.match(content, /CodocsInstanceConflictAction = 'approve' \| 'archive'/)
  })

  test('modal renders conflict rules and Codocs principal labels', () => {
    const content = source('app/components/CodocsInstanceConflictExplanationModal.vue')

    assert.match(content, /职责冲突解释/)
    assert.match(content, /initiator:\s*'发起人'/)
    assert.match(content, /submitter:\s*'提交人'/)
    assert.match(content, /当前审阅记录没有可解释的发起主体/)
  })
})
