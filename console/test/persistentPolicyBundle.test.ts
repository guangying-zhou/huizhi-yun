import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { POLICY_MAX_AGE_MS, readPolicyBundle, storePolicyBundle, type PolicyObjectStore } from '../server/utils/persistentPolicyBundle.ts'

function bucket() {
  const values = new Map<string, { body: string, etag: string }>()
  let version = 0
  const store: PolicyObjectStore = {
    async get(key) {
      const value = values.get(key)
      return value ? { etag: value.etag, text: async () => value.body } : null
    },
    async put(key, body, { onlyIf }) {
      const current = values.get(key)
      if (onlyIf.etagMatches && current?.etag !== onlyIf.etagMatches) return null
      if (onlyIf.etagDoesNotMatch === '*' && current) return null
      const value = { body, etag: String(++version) }
      values.set(key, value)
      return value
    }
  }
  return { store, values }
}

test('persistent record survives a fresh reader, expires at five minutes, and isolates scopes', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'test:tenant-a', 'key', { version: 1 }, 1000)
  assert.deepEqual((await readPolicyBundle(store, 'test:tenant-a', 'key', 1001))?.value, { version: 1 })
  assert.equal(await readPolicyBundle(store, 'prod:tenant-a', 'key', 1001), null)
  assert.equal(await readPolicyBundle(store, 'test:tenant-b', 'key', 1001), null)
  assert.equal(await readPolicyBundle(store, 'test:tenant-a', 'key', 1000 + POLICY_MAX_AGE_MS), null)
  assert.equal(await readPolicyBundle(store, 'test:tenant-a', 'key', 999), null)
})

test('tampering and wrong integrity key fail closed', async () => {
  const { store, values } = bucket()
  await storePolicyBundle(store, 'a', 'key', { allowed: false }, 1000)
  await assert.rejects(readPolicyBundle(store, 'a', 'other', 1001), /integrity/)
  for (const value of values.values()) value.body = value.body.replace('false', 'true')
  await assert.rejects(readPolicyBundle(store, 'a', 'key', 1001), /integrity/)
})

test('older overlapping sync cannot overwrite newer successfully stored record', async () => {
  const { store } = bucket()
  await Promise.all([
    storePolicyBundle(store, 'a', 'key', 2, 2000),
    storePolicyBundle(store, 'a', 'key', 1, 1000)
  ])
  assert.equal((await readPolicyBundle(store, 'a', 'key', 2001))?.value, 2)
})

test('persistent auth cache miss cannot invoke Platform and sync authenticates before refresh', () => {
  const policy = readFileSync(new URL('../server/utils/policyAuthorization.ts', import.meta.url), 'utf8')
  assert.match(policy, /shouldRefreshManagedBundle[\s\S]*?&& !persistentPolicyStoreEnabled\(\)/)
  const sync = readFileSync(new URL('../server/api/internal/policy-bundle/sync.post.ts', import.meta.url), 'utf8')
  assert.ok(sync.indexOf('await requireTenantGatewaySchedulerRequest') < sync.indexOf('await refreshPlatformBundle(\'independent-sync\''))
  assert.match(sync, /'\/api\/internal\/policy-bundle\/sync'/)
})

test('CAS returns the verified winner and reuses its encoded payload on retry', async () => {
  const { store } = bucket()
  const newer = await storePolicyBundle(store, 'a', 'key', { version: 2 }, 2000)
  const older = await storePolicyBundle(store, 'a', 'key', { version: 1 }, 1000)
  assert.deepEqual(older, newer)
  let puts = 0
  const bodies: string[] = []
  const retryStore = { ...store, async put(key: string, body: string, options: Parameters<PolicyObjectStore['put']>[2]) {
    bodies.push(body)
    if (++puts === 1) return null
    return store.put(key, body, options)
  } }
  const winner = await storePolicyBundle(retryStore, 'a', 'key', { version: 3 }, 3000)
  assert.equal(winner.value.version, 3)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
})

test('policy reads coalesce only within one request and scope, and failures can retry', async () => {
  const { coalescePolicyRead } = await import('../server/utils/persistentPolicyBundle.ts')
  const request = {}
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const read = async () => { calls++; await gate; return calls }
  const first = coalescePolicyRead(request, 'tenant-a', read)
  assert.equal(coalescePolicyRead(request, 'tenant-a', read), first)
  const separateRequest = coalescePolicyRead({}, 'tenant-a', read)
  const separateScope = coalescePolicyRead(request, 'tenant-b', read)
  await Promise.resolve()
  assert.equal(calls, 3)
  release()
  await Promise.all([first, separateRequest, separateScope])
  await assert.rejects(coalescePolicyRead(request, 'tenant-a', async () => { throw Error('unavailable') }), /unavailable/)
  assert.equal(await coalescePolicyRead(request, 'tenant-a', async () => 4), 4)
})
