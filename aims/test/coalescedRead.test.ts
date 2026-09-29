import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCoalescedRead } from '../app/utils/coalescedRead.ts'

test('identical pending product queries share one request, not a completed cache', async () => {
  let calls = 0
  let release: ((value: number) => void) | undefined
  const read = createCoalescedRead(() => {
    calls++
    return new Promise<number>(resolve => { release = resolve })
  }, () => 'tenant:user:policy')
  const first = read({ status: 'active', keyword: 'A' })
  const second = read({ keyword: 'A', status: 'active' })
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  release?.(1)
  assert.deepEqual(await Promise.all([first, second]), [1, 1])
  const next = read({ keyword: 'A', status: 'active' })
  assert.notEqual(next, first)
  await Promise.resolve()
  assert.equal(calls, 2)
  release?.(2)
  assert.equal(await next, 2)
})

test('different filters and identity scopes never share an in-flight request', async () => {
  let scope = 'tenant:one'
  let calls = 0
  const read = createCoalescedRead(async () => ++calls, () => scope)
  assert.equal(await read({}), 1)
  const filtered = read({ status: 'active' })
  scope = 'tenant:two'
  const otherIdentity = read({ status: 'active' })
  assert.notEqual(filtered, otherIdentity)
  assert.deepEqual(await Promise.all([filtered, otherIdentity]), [2, 3])
})

test('failed reads clear pending state for a later recovery attempt', async () => {
  let calls = 0
  const read = createCoalescedRead(async () => {
    calls++
    if (calls === 1) throw Error('temporarily unavailable')
    return 'ready'
  }, () => 'tenant:test')
  const first = read({})
  const same = read({})
  assert.equal(first, same)
  await assert.rejects(first, /temporarily unavailable/)
  assert.equal(await read({}), 'ready')
  assert.equal(calls, 2)
})
