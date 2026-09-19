import test from 'node:test'
import assert from 'node:assert/strict'
import { createCreationAttempt, fingerprintUploadFiles } from '../layer/creationAttempt.mjs'

test('creation retry identity survives errors and separates payload, session, and completed attempts', () => {
  let sequence = 0
  const attempt = createCreationAttempt(() => `key-${++sequence}`)
  const first = attempt.keyFor('tenant:user1', { title: 'A', content: 'text' })
  assert.equal(attempt.keyFor('tenant:user1', { content: 'text', title: 'A' }), first)
  const changed = attempt.keyFor('tenant:user1', { title: 'B' })
  assert.notEqual(changed, first)
  attempt.complete(first) // an older in-flight request cannot clear the new one
  assert.equal(attempt.keyFor('tenant:user1', { title: 'B' }), changed)
  const other = attempt.keyFor('tenant:user2', { title: 'B' })
  assert.notEqual(other, changed)
  attempt.complete(other)
  assert.notEqual(attempt.keyFor('tenant:user2', { title: 'B' }), other)
})

test('upload fingerprint binds bytes and order, not just filename and size', async () => {
  const a = new File(['abc'], 'same.md')
  const b = new File(['xyz'], 'same.md')
  const first = await fingerprintUploadFiles([a, b])
  assert.notEqual(first[0][2], first[1][2])
  assert.deepEqual(await fingerprintUploadFiles([a, b]), first)
  assert.deepEqual(await fingerprintUploadFiles([b, a]), [first[1], first[0]])
})
