import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectDiskSpace, MINIMUM_FREE_BYTES } from '../preflight-disk-space.mjs'
import { inspectMigrationReadiness } from '../preflight-w1-ddl.mjs'
const stats = bytes => async (_path, options) => {
  assert.equal(options.bigint, true)
  return { bavail: bytes, bsize: 1n, bfree: 100n * MINIMUM_FREE_BYTES }
}
test('20 GiB floor cannot be reduced and uses available blocks', async () => {
  assert.equal((await inspectDiskSpace('/tmp', {}, stats(MINIMUM_FREE_BYTES - 1n))).ready, false)
  assert.equal((await inspectDiskSpace('/tmp', { logBytes: '1' }, stats(MINIMUM_FREE_BYTES))).ready, true)
})
test('backup, staging, logs and rollback reserve raise the required space', async () => {
  const budget = { backupBytes: String(8n << 30n), stagingBytes: String(8n << 30n), logBytes: String(8n << 30n), safetyBytes: String(4n << 30n) }
  const r = await inspectDiskSpace('/tmp', budget, stats(27n << 30n))
  assert.equal(r.requiredBytes, String(28n << 30n))
  assert.equal(r.code, 'disk_space_insufficient')
})
test('missing filesystem, invalid budgets and negative stats fail closed without raw errors', async () => {
  for (const budget of [{ logBytes: '-1' }, { logBytes: 'NaN' }, { unknown: '1' }]) assert.equal((await inspectDiskSpace('/tmp', budget)).ready, false)
  const r = await inspectDiskSpace('/tmp', {}, async () => { throw new Error('private path SECRET') })
  assert.deepEqual(r, { ready: false, code: 'disk_space_check_failed' })
  assert.equal((await inspectDiskSpace('/tmp', {}, stats(-1n))).ready, false)
})
test('a fresh check before apply observes depletion, not the prior ready result', async () => {
  let calls = 0
  const read = async () => ({ bavail: ++calls === 1 ? 63n << 30n : 19n << 30n, bsize: 1n })
  assert.equal((await inspectDiskSpace('/tmp', {}, read)).ready, true)
  assert.equal((await inspectDiskSpace('/tmp', {}, read)).ready, false)
})
test('disk failure aggregates with identity and DDL failures', async () => {
  let identities = 0
  const r = await inspectMigrationReadiness({ query: async () => { throw new Error() } }, async () => { identities++; return { ready: true } }, async () => ({ ready: false, code: 'disk_space_insufficient' }))
  assert.equal(identities, 1)
  assert.equal(r.ready, false)
  assert.equal(r.disk.code, 'disk_space_insufficient')
})
