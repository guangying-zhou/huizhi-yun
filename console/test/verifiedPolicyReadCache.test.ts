import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readThroughVerifiedPolicy, rememberSynchronizedPolicy, resetVerifiedPolicyReadCache } from '../server/utils/verifiedPolicyReadCache.ts'
import type { CachedPolicyBundle } from '../server/utils/bundleCache.ts'

const bundle = (version: string, expiresAt: number) => ({ bundleVersion: version, expiresAt: new Date(expiresAt).toISOString() }) as CachedPolicyBundle

test('verified policy view is reused across requests only within the TTL', async () => {
  resetVerifiedPolicyReadCache()
  let clock = 1_000_000
  let loads = 0
  const load = async () => { loads += 1; return bundle(`v${loads}`, clock + 300_000) }
  assert.equal((await readThroughVerifiedPolicy('k', 30_000, load, () => clock))?.bundleVersion, 'v1')
  clock += 29_999
  assert.equal((await readThroughVerifiedPolicy('k', 30_000, load, () => clock))?.bundleVersion, 'v1')
  clock += 1
  assert.equal((await readThroughVerifiedPolicy('k', 30_000, load, () => clock))?.bundleVersion, 'v2')
  assert.equal(loads, 2)
})

test('cached view is never served past its signed deadline', async () => {
  resetVerifiedPolicyReadCache()
  let clock = 1_000_000
  let loads = 0
  const load = async () => { loads += 1; return bundle(`v${loads}`, clock + 5_000) }
  await readThroughVerifiedPolicy('k', 30_000, load, () => clock)
  clock += 5_000
  assert.equal((await readThroughVerifiedPolicy('k', 30_000, load, () => clock))?.bundleVersion, 'v2')
})

test('failures and missing policy are never cached; TTL 0 disables reuse', async () => {
  resetVerifiedPolicyReadCache()
  let loads = 0
  await assert.rejects(readThroughVerifiedPolicy('k', 30_000, async () => { loads += 1; throw Error('runtime down') }), /runtime down/)
  assert.equal(await readThroughVerifiedPolicy('k', 30_000, async () => { loads += 1; return null }), null)
  const ok = async () => { loads += 1; return bundle('v', Date.now() + 60_000) }
  await readThroughVerifiedPolicy('k', 30_000, ok)
  await readThroughVerifiedPolicy('k', 30_000, ok)
  assert.equal(loads, 3)
  await readThroughVerifiedPolicy('z', 0, ok)
  await readThroughVerifiedPolicy('z', 0, ok)
  assert.equal(loads, 5)
})

test('entries are scoped by binding key and concurrent reads share one Runtime read', async () => {
  resetVerifiedPolicyReadCache()
  let loads = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const load = async () => { loads += 1; await gate; return bundle(`v${loads}`, Date.now() + 60_000) }
  const reads = [readThroughVerifiedPolicy('a', 30_000, load), readThroughVerifiedPolicy('a', 30_000, load)]
  release()
  const [first, second] = await Promise.all(reads)
  assert.equal(first, second)
  assert.equal(loads, 1)
  await readThroughVerifiedPolicy('b', 30_000, load)
  assert.equal(loads, 2)
})

test('synchronization replaces the cache and a stale in-flight read cannot overwrite it', async () => {
  resetVerifiedPolicyReadCache()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const stale = readThroughVerifiedPolicy('k', 30_000, async () => { await gate; return bundle('old', Date.now() + 60_000) })
  rememberSynchronizedPolicy('k', bundle('new', Date.now() + 60_000))
  release()
  assert.equal((await stale)?.bundleVersion, 'old')
  let loads = 0
  const read = await readThroughVerifiedPolicy('k', 30_000, async () => { loads += 1; return bundle('reloaded', Date.now() + 60_000) })
  assert.equal(read?.bundleVersion, 'new')
  assert.equal(loads, 0)
})

test('Console verified policy reads and writes go through the bounded cache', () => {
  const runtime = readFileSync(new URL('../server/utils/verifiedPolicyRuntime.ts', import.meta.url), 'utf8')
  assert.match(runtime, /readThroughVerifiedPolicy\(readKey, policyMemoryCacheTtlMs\(request\)/)
  assert.match(runtime, /rememberSynchronizedPolicy\(verifiedPolicyReadKey\(key, context\), synchronized\)/)
  const cache = readFileSync(new URL('../server/utils/bundleCache.ts', import.meta.url), 'utf8')
  assert.match(cache, /Math\.min\(policyMaxAgeMs\(event\), runtimeNumberValue\('HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS', 30_000/)
})
