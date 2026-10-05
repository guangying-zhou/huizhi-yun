import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicServiceCommandOperationId } from '../server/utils/deterministicServiceCommandOperationId.ts'

test('deterministic service-command operation IDs are stable UUIDv4 values', () => {
  const first = deterministicServiceCommandOperationId('dingtalk-profile', 'job:batch:1')
  const replay = deterministicServiceCommandOperationId('dingtalk-profile', 'job:batch:1')
  const next = deterministicServiceCommandOperationId('dingtalk-profile', 'job:batch:2')

  assert.equal(first, replay)
  assert.notEqual(first, next)
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
