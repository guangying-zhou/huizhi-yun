import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { POLICY_MAX_AGE_MS, TEST_POLICY_MAX_AGE_MS, boundedPolicyMaxAgeMs, readPolicyBundle, storePolicyBundle, type PolicyObjectStore } from '../server/utils/persistentPolicyBundle.ts'

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

test('test freshness override is bounded at twenty-six hours while the default remains five minutes', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'test:tenant-a', 'key', { version: 1 }, 1_000)
  assert.equal(boundedPolicyMaxAgeMs('93600000'), TEST_POLICY_MAX_AGE_MS)
  assert.equal(boundedPolicyMaxAgeMs(String(TEST_POLICY_MAX_AGE_MS + 1)), POLICY_MAX_AGE_MS)
  assert.deepEqual((await readPolicyBundle(store, 'test:tenant-a', 'key', 1_000 + TEST_POLICY_MAX_AGE_MS - 1, TEST_POLICY_MAX_AGE_MS))?.value, { version: 1 })
  assert.equal(await readPolicyBundle(store, 'test:tenant-a', 'key', 1_000 + TEST_POLICY_MAX_AGE_MS, TEST_POLICY_MAX_AGE_MS), null)
  assert.equal(await readPolicyBundle(store, 'test:tenant-a', 'key', 1_000 + POLICY_MAX_AGE_MS), null)
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
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = async () => {
    calls++
    await gate
    return calls
  }
  const first = coalescePolicyRead(request, 'tenant-a', read)
  assert.equal(coalescePolicyRead(request, 'tenant-a', read), first)
  const separateRequest = coalescePolicyRead({}, 'tenant-a', read)
  const separateScope = coalescePolicyRead(request, 'tenant-b', read)
  await Promise.resolve()
  assert.equal(calls, 3)
  release()
  await Promise.all([first, separateRequest, separateScope])
  await assert.rejects(coalescePolicyRead(request, 'tenant-a', async () => {
    throw Error('unavailable')
  }), /unavailable/)
  assert.equal(await coalescePolicyRead(request, 'tenant-a', async () => 4), 4)
})

function enterpriseBundle(revision: number, policyRevision: number, status = 'active', tenantCode = 'A') {
  return { tenantCode, payload: { policyRevision, generatedAt: '2026-09-13T00:00:00Z',
    enterpriseEntitlement: { schemaVersion: 'enterprise-entitlement.v1', productCode: 'enterprise-full', tenantCode,
      revision, status: 'active', effectiveStatus: status, effectiveFrom: '2026-09-01T00:00:00Z', end: { kind: 'unlimited', evidenceReference: 'migration-1' } },
    roles: [{ roleCode: 'viewer' }]
  } }
}

test('durable enterprise watermark survives fresh client and expired read TTL', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 12), 1000)
  assert.equal(await readPolicyBundle(store, 'A', 'key', 1000 + POLICY_MAX_AGE_MS), null)
  // Recreate the storage client with no memory state; the old sealed row remains authoritative.
  const restarted = { get: store.get, put: store.put }
  await assert.rejects(storePolicyBundle(restarted, 'A', 'key', enterpriseBundle(1, 13), 999999), /rollback/)
  await assert.rejects(storePolicyBundle(restarted, 'A', 'key', enterpriseBundle(2, 11), 999999), /rollback/)
  await assert.rejects(storePolicyBundle(restarted, 'A', 'key', { payload: {} }, 999999), /rollback/)
  await storePolicyBundle(restarted, 'B', 'key', enterpriseBundle(1, 1, 'active', 'B'), 999999)
  await assert.rejects(storePolicyBundle(restarted, 'A', 'key', enterpriseBundle(3, 13, 'active', 'B'), 999999), /rollback/)
})

test('same enterprise revision permits derived status only with a newer signed policy revision', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 12), 1000)
  await assert.rejects(storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 12, 'suspended'), 2000), /policy revision content conflict/)
  await storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 13, 'suspended'), 2000)
  const changed = enterpriseBundle(2, 14, 'suspended')
  changed.payload.enterpriseEntitlement.end.evidenceReference = 'changed'
  await assert.rejects(storePolicyBundle(store, 'A', 'key', changed, 3000), /qualification conflict/)
  const regenerated = enterpriseBundle(2, 13, 'suspended')
  regenerated.payload.generatedAt = '2026-09-14T00:00:00Z'
  await storePolicyBundle(store, 'A', 'key', regenerated, 3000)
})

test('CAS retry reevaluates current durable watermark after a concurrent winner', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'A', 'key', enterpriseBundle(1, 1), 1000)
  let raced = false
  const racer: PolicyObjectStore = { ...store, async put(key, body, options) {
    if (!raced) {
      raced = true
      await storePolicyBundle(store, 'A', 'key', enterpriseBundle(3, 3), 3000)
      return null
    }
    return store.put(key, body, options)
  } }
  await assert.rejects(storePolicyBundle(racer, 'A', 'key', enterpriseBundle(2, 2), 4000), /rollback/)
  assert.equal((await readPolicyBundle<ReturnType<typeof enterpriseBundle>>(store, 'A', 'key', 3001))?.value.payload.enterpriseEntitlement.revision, 3)
})

test('integrity failure cannot erase a persisted watermark using a new key', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'A', 'old-key', enterpriseBundle(2, 2), 1000)
  await assert.rejects(storePolicyBundle(store, 'A', 'new-key', enterpriseBundle(1, 3), 2000), /integrity/)
  assert.equal((await readPolicyBundle<ReturnType<typeof enterpriseBundle>>(store, 'A', 'old-key', 1001))?.value.payload.enterpriseEntitlement.revision, 2)
})

test('same millisecond higher signed policy revision replaces the previous persisted facts', async () => {
  const { store } = bucket()
  await storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 12), 1000)
  const result = await storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 13, 'suspended'), 1000)
  assert.equal(result.value.payload.policyRevision, 13)
  assert.equal((await readPolicyBundle<ReturnType<typeof enterpriseBundle>>(store, 'A', 'key', 1000))?.value.payload.policyRevision, 13)
  await assert.rejects(storePolicyBundle(store, 'A', 'key', enterpriseBundle(2, 12), 1000), /rollback/)
})
