import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeProjectDocumentAccessResult, projectDocumentAccessDeniedMessage } from '../app/utils/projectDocumentAccessResult'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/projectDocumentAccess.runtime.json', import.meta.url), 'utf8'))

test('real Runtime repository member response allows opening; outsider and deleted deny', () => {
  assert.equal(normalizeProjectDocumentAccessResult(fixtures.repositoryMember).allowed, true)
  assert.equal(normalizeProjectDocumentAccessResult(fixtures.repositoryOutsider).allowed, false)
  const missing = normalizeProjectDocumentAccessResult(fixtures.missingDocument)
  assert.equal(missing.allowed, false)
  assert.equal(missing.lifecycleStage, undefined)
  assert.equal(projectDocumentAccessDeniedMessage(missing.reason), '文档不存在或已删除')
})

test('malformed ACL responses fail closed without reason.startsWith crashes', () => {
  for (const response of [undefined, null, {}, { code: 0 }, { code: 0, data: { allowed: false } }, { code: 0, data: { allowed: true } }, { code: 0, data: { ...fixtures.repositoryMember.data, permission: 'none' } }, { code: 403, data: fixtures.repositoryMember.data }]) {
    const result = normalizeProjectDocumentAccessResult(response)
    assert.equal(result.allowed, false)
    assert.equal(result.readonly, true)
    assert.equal(projectDocumentAccessDeniedMessage(result.reason), '文档访问校验未完成，请重试')
  }
  assert.equal(projectDocumentAccessDeniedMessage(undefined), '文档访问校验未完成，请重试')
  assert.equal(projectDocumentAccessDeniedMessage('granted_by_user'), '你没有权限访问该文档')
})

test('readonly and revoked grant responses remain denied', () => {
  for (const reason of ['readonly', 'no_matching_grant']) {
    const result = normalizeProjectDocumentAccessResult({ code: 0, data: { ...fixtures.repositoryOutsider.data, reason } })
    assert.equal(result.allowed, false)
    assert.ok(projectDocumentAccessDeniedMessage(result.reason))
  }
})
