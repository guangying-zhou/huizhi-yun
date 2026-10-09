import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewMutationIntent } from '../shared/utils/reviewMutationIntent'

test('review intent retains one key after a lost response and rejects changed payloads', async () => {
  let count = 0

  const intent = createReviewMutationIntent('review', ['version_conflict'], () => `key-${++count}`)

  const request = { method: 'POST' as const, path: '/object/1', body: { expectedVersion: 1, reason: '合成原因' } }

  const keys: string[] = []

  await assert.rejects(intent.submit(request, async (_, key) => {
    keys.push(key)

    throw Error('fetch failed')
  }))

  assert.equal(intent.uncertain, true)

  assert.equal(intent.reset(), false)

  await assert.rejects(intent.submit({ ...request, body: { expectedVersion: 2 } }, async () => {}), /请先重试/)

  await intent.submit(request, async (_, key) => {
    keys.push(key)
  })

  assert.deepEqual(keys, ['key-1', 'key-1'])

  assert.equal(count, 1)
})
test('only an explicit final CAS conflict allows a new reviewed intent; replay conflicts stay frozen', async () => {
  let count = 0

  const intent = createReviewMutationIntent('review', ['version_conflict'], () => `key-${++count}`)

  const request = { method: 'PATCH' as const, path: '/object/1', body: { expectedVersion: 1 } }

  const conflict = { statusCode: 409, data: { data: { code: 'version_conflict' } } }

  await assert.rejects(intent.submit(request, async () => {
    throw conflict
  }), error => error === conflict)

  assert.equal(intent.uncertain, false)

  intent.reset()

  await intent.submit({ ...request, body: { expectedVersion: 2 } }, async (_, key) => {
    assert.equal(key, 'key-2')
  })

  await assert.rejects(intent.submit(request, async () => {
    throw { statusCode: 409, data: { code: 'idempotency_conflict' } }
  }))

  assert.equal(intent.uncertain, true)
})
