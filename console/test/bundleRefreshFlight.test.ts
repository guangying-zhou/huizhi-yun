import assert from 'node:assert/strict'
import test from 'node:test'
import { createBundleRefreshFlight } from '../server/utils/bundleRefreshFlight.ts'

test('concurrent same-context misses share refresh, completed values are not cached', async () => {
  const refresh = createBundleRefreshFlight<number>()
  let calls = 0
  const run = async () => ++calls
  const first = refresh('tenant-a:prod:deployment-a', run)
  assert.equal(refresh('tenant-a:prod:deployment-a', run), first)
  assert.equal(await first, 1)
  assert.equal(await refresh('tenant-a:prod:deployment-a', run), 2)
})

test('different contexts do not share a refresh', async () => {
  const refresh = createBundleRefreshFlight<number>()
  let calls = 0
  await Promise.all(['tenant-a:prod', 'tenant-a:test', 'tenant-b:prod'].map(key => refresh(key, async () => ++calls)))
  assert.equal(calls, 3)
})

test('failed refresh rejects all waiters and allows retry', async () => {
  const refresh = createBundleRefreshFlight<number>()
  const failure = new Error('unavailable')
  const first = refresh('a', async () => {
    throw failure
  })
  const second = refresh('a', async () => 1)
  assert.equal(first, second)
  await assert.rejects(first, error => error === failure)
  assert.equal(await refresh('a', async () => 2), 2)
})
