import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupCopyStaging, parseArgs, STAGING_PREFIX } from './cleanup-codocs-copy-staging.mjs'

const now = Date.parse('2026-09-30T00:00:00Z')
const at = hoursAgo => new Date(now - hoursAgo * 3600_000).toISOString()

function fakeClient(objects, { failOn = '' } = {}) {
  const deleted = []
  const calls = []
  return {
    deleted,
    calls,
    async listV2(params) {
      calls.push(params)
      const start = Number(params['continuation-token'] || 0)
      const page = objects.slice(start, start + 2)
      const end = start + page.length
      return { objects: page, isTruncated: end < objects.length, nextContinuationToken: String(end) }
    },
    async delete(name) {
      if (name === failOn) throw new Error('boom')
      deleted.push(name)
    }
  }
}

const objects = [
  { name: `${STAGING_PREFIX}old1.md`, lastModified: at(48) },
  { name: `${STAGING_PREFIX}fresh.md`, lastModified: at(1) },
  { name: `${STAGING_PREFIX}old2.md`, lastModified: at(25) },
  { name: 'codocs/other/old.md', lastModified: at(500) },
  { name: `${STAGING_PREFIX}badtime.md`, lastModified: 'x' }
]

test('dry-run is the default and deletes nothing', async () => {
  const client = fakeClient(objects)
  const summary = await cleanupCopyStaging(client, { now })
  assert.equal(summary.mode, 'dry-run')
  assert.equal(summary.candidates, 2)
  assert.equal(summary.deleted, 0)
  assert.deepEqual(client.deleted, [])
  assert.ok(client.calls.every(call => call.prefix === STAGING_PREFIX))
})

test('apply deletes only staging objects older than 24h and requires confirmation', async () => {
  await assert.rejects(cleanupCopyStaging(fakeClient(objects), { apply: true, now }), /--confirm-delete-copy-staging/)
  const client = fakeClient(objects)
  const summary = await cleanupCopyStaging(client, { apply: true, confirmed: true, now })
  assert.deepEqual(client.deleted, [`${STAGING_PREFIX}old1.md`, `${STAGING_PREFIX}old2.md`])
  assert.equal(summary.deleted, 2)
  assert.equal(summary.kept, 3)
})

test('refuses any prefix other than exactly codocs/copy-staging/ and ages under 24h', async () => {
  for (const prefix of ['codocs/', 'codocs/copy-staging', 'codocs/copy-staging/x/', '']) {
    const client = fakeClient(objects)
    await assert.rejects(cleanupCopyStaging(client, { prefix, apply: true, confirmed: true, now }), /Refusing prefix/)
    assert.equal(client.calls.length, 0)
  }
  await assert.rejects(cleanupCopyStaging(fakeClient(objects), { minAgeHours: 1, now }), /min-age-hours/)
})

test('a delete failure is counted without aborting and CLI parsing rejects unknown flags', async () => {
  const client = fakeClient(objects, { failOn: `${STAGING_PREFIX}old1.md` })
  const summary = await cleanupCopyStaging(client, { apply: true, confirmed: true, now })
  assert.equal(summary.failed, 1)
  assert.equal(summary.deleted, 1)
  assert.equal(parseArgs([]).apply, false)
  assert.throws(() => parseArgs(['--delete']), /Unknown argument/)
})
