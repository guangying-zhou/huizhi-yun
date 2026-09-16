import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestAuthMemo } from '../server/utils/requestAuthMemo'

test('same event and identity performs one check, concurrent or sequential', async () => {
  const memo = createRequestAuthMemo<boolean>()
  const event = {}
  let calls = 0
  const load = async () => {
    calls++
    return true
  }
  assert.deepEqual(await Promise.all([memo(event, 'a', load), memo(event, 'a', load)]), [true, true])
  assert.equal(await memo(event, 'a', load), true)
  assert.equal(calls, 1)
})

test('new event and changed identity recheck, including revoked state', async () => {
  const memo = createRequestAuthMemo<boolean>()
  const event = {}
  assert.equal(await memo(event, 'a', async () => true), true)
  assert.equal(await memo({}, 'a', async () => false), false)
  assert.equal(await memo(event, 'b', async () => false), false)
})

test('failures cannot fall back to a successful result from another event', async () => {
  const memo = createRequestAuthMemo<boolean>()
  await memo({}, 'a', async () => true)
  await assert.rejects(memo({}, 'a', async () => {
    throw new Error('unavailable')
  }), /unavailable/)
})
