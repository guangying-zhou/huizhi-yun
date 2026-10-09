import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codocsUpstreamMessage, codocsUpstreamStatus } from '../server/utils/codocsProjectCabinetFallback.ts'

test('codocs upstream status reads known error shapes', () => {
  assert.equal(codocsUpstreamStatus({ statusCode: 503 }), 503)
  assert.equal(codocsUpstreamStatus({ status: 404 }), 404)
  assert.equal(codocsUpstreamStatus({ response: { status: 502 } }), 502)
  assert.equal(codocsUpstreamStatus(new Error('plain error')), 0)
})

test('codocs upstream message prefers response data message', () => {
  assert.equal(
    codocsUpstreamMessage({
      message: 'outer',
      data: { message: 'inner' }
    }),
    'inner'
  )
  assert.equal(codocsUpstreamMessage(new Error('plain error')), 'plain error')
  assert.equal(codocsUpstreamMessage({}, 'fallback'), 'fallback')
})
