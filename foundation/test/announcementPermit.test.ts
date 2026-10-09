import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { announcementPermitCanonical, announcementPermission, announcementPermitPath } from '../server/utils/announcementPermit'
import { renderSafeMarkdown } from '../shared/utils/safeMarkdown'

const vector = JSON.parse(readFileSync(new URL('../../data-runtime/internal/server/testdata/announcement-permit.json', import.meta.url), 'utf8'))
test('announcement permit matches shared TS/Go golden vector and binds whole payload/key', () => {
  const canonical = announcementPermitCanonical(vector.method, vector.path, vector.body, vector.key)
  assert.equal(canonical, vector.canonical)
  assert.equal(createHmac('sha256', vector.token).update(canonical).digest('base64url'), vector.signature)
  assert.notEqual(announcementPermitCanonical(vector.method, vector.path, { ...vector.body, payload: '{}' }, vector.key), canonical)
  assert.notEqual(announcementPermitCanonical(vector.method, vector.path, vector.body, 'other'), canonical)
  assert.equal(announcementPermission('save'), 'admin')
  assert.equal(announcementPermission('withdraw'), 'admin')
  assert.equal(announcementPermission('read'), 'view')
  for (const op of ['deliver', 'delivery-claim', 'delivery-ack'] as const) {
    assert.equal(announcementPermission(op), 'admin')
    assert.equal(announcementPermitPath(`/v1/enterprise/console/announcements:${op}`), true)
  }
  assert.equal(announcementPermitPath('/v1/enterprise/console/announcements:read'), true)
  assert.equal(announcementPermitPath('/v1/enterprise/console/announcements:arbitrary'), false)
})
test('tenant Markdown cannot inject HTML, scripts, unsafe links or remote tracking images', () => {
  const html = renderSafeMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n![tracker](https://tracker.invalid/a)\n[说明](/enterprise/help)\n\n# 标题')
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('href="javascript:'))
  assert.ok(html.includes('href="/enterprise/help"'))
  assert.ok(html.includes('<h1>标题</h1>'))
})
