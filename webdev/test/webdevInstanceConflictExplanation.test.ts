import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('WebDev instance conflict explanation', () => {
  test('server helper loads job facts from data-runtime and calls Console runtime', () => {
    const content = source('server/utils/webdevInstanceConflictExplanation.ts')

    assert.match(content, /loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /dataRuntimeFetch/)
    assert.match(content, /\/v1\/webdev\/jobs\/\$\{encodeURIComponent\(id\)\}/)
    assert.match(content, /resourceCode: 'webdev_workspace'/)
    assert.match(content, /defaultAction: 'deploy'/)
    assert.match(content, /action,/)
    assert.match(content, /createdBy/)
    assert.match(content, /kind: 'executor'/)
    assert.match(content, /webdev:job:\$\{code\}/)
  })

  test('local API route requires deploy permission before explanation', () => {
    const content = source('server/api/webdev/authorization/instance-conflict-explain.post.ts')

    assert.match(content, /requireWebDevPermission\(event, 'webdev_workspace', 'deploy'\)/)
    assert.match(content, /explainWebDevInstanceConflicts/)
    assert.match(content, /targetType: body\.targetType/)
    assert.match(content, /authorizationMode: body\.authorizationMode/)
  })

  test('history page exposes an inline deployment conflict explanation entry', () => {
    const content = source('app/pages/history.vue')

    assert.match(content, /\/api\/webdev\/authorization\/instance-conflict-explain/)
    assert.match(content, /targetType: 'job'/)
    assert.match(content, /action: 'deploy'/)
    assert.match(content, /部署职责冲突解释/)
    assert.match(content, /#actions-cell/)
    assert.match(content, /principalLabel/)
  })
})
