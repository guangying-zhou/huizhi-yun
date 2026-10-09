import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { feedbackPermitCanonical, feedbackPermitPath, feedbackPermission } from '../server/utils/feedbackPermit'
import { redactFeedbackDiagnostic, feedbackPageURL, feedbackSubmissionURL } from '../shared/utils/feedbackPrivacy'

test('feedback Go/TS golden binds payload, actor, tenant, deployment, scope, policy and intent', () => {
  const v = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/feedback-permit.json', import.meta.url), 'utf8'))
  const canonical = feedbackPermitCanonical(v.method, v.path, v.body, v.key)
  assert.equal(canonical, v.canonical)
  assert.equal(createHmac('sha256', v.token).update(canonical).digest('base64url'), v.signature)
  assert.equal(feedbackPermitPath('/v1/enterprise/console/feedback:draft'), true)
  assert.equal(feedbackPermitPath('/v1/console/feedback:drain'), false)
  assert.equal(feedbackPermission('retry').action, 'retry')
  assert.equal(feedbackPermission('draft').action, 'submit')
})
test('diagnostics redact credentials, signed URLs, connections and PII before buffering', () => {
  for (const input of ['Bearer TOPSECRET', 'token=TOPSECRET', 'mysql://root:TOPSECRET@db/internal', 'https://user:TOPSECRET@example.test/a?token=TOPSECRET#TOPSECRET', 'Cookie: TOPSECRET']) {
    assert.ok(!redactFeedbackDiagnostic(input).includes('TOPSECRET'), input)
  }
  assert.equal(feedbackPageURL('https://example.test/page?secret=x#x'), 'https://example.test/page')
  assert.ok(!redactFeedbackDiagnostic('a@example.test 13800138000').includes('13800138000'))
})

test('current browser alias is normalized to a tenant-relative page, foreign URLs remain untrusted', () => {
  assert.equal(feedbackSubmissionURL('https://work.example.test/enterprise?a=secret', 'https://work.example.test'), '/enterprise')
  assert.equal(feedbackSubmissionURL('https://evil.test/path', 'https://work.example.test'), 'https://evil.test/path')
})

test('feedback labels are business Chinese and local dates use the shared formatter', async () => {
  const { feedbackKinds, feedbackPriorities, feedbackStates } = await import('../shared/utils/feedbackLabels')
  const { formatDateTime } = await import('../app/utils/format')
  assert.equal(feedbackPriorities.mid, '中')
  assert.equal(feedbackPriorities.blocking, '紧急')
  assert.deepEqual(Object.values(feedbackKinds), ['问题', '需求', '建议'])
  assert.equal(feedbackStates.submitted, '已建单')
  assert.equal(feedbackStates.failed, '创建失败，等待管理员处理')
  assert.match(formatDateTime('2026-10-08T20:41:24.649Z', { timeZone: 'Asia/Shanghai', second: undefined }), /2026.*10.*09.*04:41/)
})

test('feedback media Go/TS golden binds payload, actor, tenant, deployment, scope, policy and intent', () => {
  const v = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/feedback-media-permit.json', import.meta.url), 'utf8'))
  const canonical = feedbackPermitCanonical(v.method, v.path, v.body, v.key)
  assert.equal(canonical, v.canonical)
  assert.equal(createHmac('sha256', v.token).update(canonical).digest('base64url'), v.signature)
  assert.equal(feedbackPermitPath('/v1/enterprise/console/feedback:draft'), true)
  assert.equal(feedbackPermitPath('/v1/console/feedback:drain'), false)
  assert.equal(feedbackPermission('retry').action, 'retry')
  assert.equal(feedbackPermission('attachment-put').action, 'submit')
})
