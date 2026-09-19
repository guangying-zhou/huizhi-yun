import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as entitlement from '../server/utils/enterpriseEntitlement.ts'
import * as persistence from '../server/utils/persistentPolicyBundle.ts'

function harness(backend = 'runtime', throwOnUseEvent = false, extraEnv: Record<string, string> = {}) {
  let now = 1_000_000
  let gets = 0
  const values = new Map<string, { body: string, etag: string }>()
  const store: persistence.PolicyObjectStore = {
    async get(key) { gets++; const value = values.get(key); return value ? { etag: value.etag, text: async () => value.body } : null },
    async put(key, body, { onlyIf }) {
      const current = values.get(key)
      if (onlyIf.etagMatches && current?.etag !== onlyIf.etagMatches) return null
      if (onlyIf.etagDoesNotMatch && current) return null
      values.set(key, { body, etag: `${Number(current?.etag || 0) + 1}` })
      return {}
    }
  }
  const event = { context: { cloudflare: { env: {
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: backend, HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '300000',
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-integrity-key', ...extraEnv
  } } } }
  const require = createRequire(import.meta.url)
  const exports: Record<string, any> = {}
  const source = ts.transpileModule(readFileSync(new URL('../server/utils/bundleCache.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(source, { exports, process, Buffer, Date: class extends Date { static now() { return now } }, require(name: string) {
    if (name === './enterpriseEntitlement') return entitlement
    if (name === 'h3') return { createError, getHeader: () => '' }
    if (name === 'nitropack/runtime') return { useEvent: () => {
      if (throwOnUseEvent) throw new Error('request event unavailable')
      return event
    } }
    if (name.includes('consolePolicyStore')) return { consolePolicyStore: () => store }
    if (name === './persistentPolicyBundle') return { ...persistence,
      readPolicyBundle: (s: persistence.PolicyObjectStore, scope: string, secret: string, _readNow?: number, maxAgeMs?: number) => persistence.readPolicyBundle(s, scope, secret, now, maxAgeMs) }
    return require(name)
  } })
  const bundle = (at = now, expiresAt: string | null = null) => ({ status: 'active', tenantCode: 'tenant', deploymentCode: 'console',
    bundleVersion: String(at), payload: {}, cachedAt: new Date(at).toISOString(), expiresAt })
  return { api: exports, store, bundle, get gets() { return gets }, setNow(value: number) { now = value } }
}

test('explicit Cloudflare event selects Runtime backend when useEvent and process env are unavailable', async () => {
  const h = harness('runtime', true)
  const event = { context: { cloudflare: { env: {
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'runtime',
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: 'managed-cloud-console:test:tenant',
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-integrity-key'
  } } } }
  const descriptor = h.api.getRuntimeCacheDescriptor('/unused', null, event)
  assert.equal(descriptor.backend, 'runtime')
  assert.equal(descriptor.cacheDir, null)
  assert.equal(descriptor.table, 'policy_bundle_snapshots')
  assert.equal(descriptor.scope, 'managed-cloud-console:test:tenant')
  assert.equal(descriptor.legacyFallback, false)
  assert.equal(await h.api.readCachedBundle('/unused', null, event), null)
  const bundle = h.bundle()
  await h.api.writeCachedBundle('/unused', bundle, 'managed-cloud-console:test:tenant', event)
  assert.equal((await h.api.readCachedBundle('/unused', 'managed-cloud-console:test:tenant', event))?.bundleVersion, bundle.bundleVersion)
  assert.equal((await h.api.readActivationStatus('/unused', 'managed-cloud-console:test:tenant', event)).activated, true)
})

test('cold activation and authorization share one persistent read; CAS sync needs no status reread', async () => {
  const h = harness()
  await persistence.storePolicyBundle(h.store, 'scope', 'test-integrity-key', h.bundle(), 1_000_000)
  const before = h.gets
  const [status, bundle] = await Promise.all([h.api.readActivationStatus('', 'scope'), h.api.readCachedBundle('', 'scope')])
  assert.equal(h.gets - before, 1)
  assert.equal(status.bundleVersion, bundle.bundleVersion)
  h.setNow(1_000_001)
  const syncStart = h.gets
  await h.api.writeCachedBundle('', h.bundle(1_000_001), 'scope')
  assert.equal((await h.api.readActivationStatus('', 'scope')).bundleVersion, '1000001')
  assert.equal(h.gets - syncStart, 1)
})

test('older sync keeps the CAS winner and cached readiness expires at the original deadline', async () => {
  const h = harness()
  await h.api.writeCachedBundle('', h.bundle(), 'scope')
  await h.api.writeCachedBundle('', h.bundle(999_999), 'scope')
  assert.equal((await h.api.readCachedBundle('', 'scope')).bundleVersion, '1000000')
  h.setNow(1_300_000)
  assert.equal(await h.api.readCachedBundle('', 'scope'), null)
  assert.equal((await h.api.readActivationStatus('', 'scope')).activated, false)
})

test('bundle expiry and scope isolation remain enforced after write-through caching', async () => {
  const h = harness()
  await h.api.writeCachedBundle('', h.bundle(1_000_000, new Date(1_000_010).toISOString()), 'scope')
  assert.equal(await h.api.readCachedBundle('', 'different-scope'), null)
  h.setNow(1_000_010)
  assert.equal(await h.api.readCachedBundle('', 'scope'), null)
})

test('enterprise Runtime cache enforces refresh deadline even for direct readers', async () => {
  const h = harness('runtime')
  const bundle = { ...h.bundle(), payload: { policyRevision: 1, enterpriseEntitlement: {
    schemaVersion: 'enterprise-entitlement.v1', productCode:'enterprise-full',tenantCode:'tenant',revision:1,
    status:'active',effectiveStatus:'active',effectiveFrom:'1970-01-01T00:00:00Z',end:{kind:'unlimited',evidenceReference:'test-reference'}
  } } }
  await h.api.writeCachedBundle('/unused',bundle,'scope')
  assert.ok(await h.api.readCachedBundle('/unused','scope'))
  assert.equal(await h.api.readCachedBundle('/unused','another-tenant'),null)
  h.setNow(1_300_000)
  assert.equal(await h.api.readCachedBundle('/unused','scope'),null)
  await assert.rejects(h.api.writeCachedBundle('/unused',bundle,'scope'),/invalid enterprise/)
})

test('test-only 26-hour cache window remains bounded and never revives an expired signed bundle', async () => {
  const h = harness('runtime', false, {
    HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_PLATFORM_BUNDLE_MAX_AGE_MS: '93600000',
    HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '93600000'
  })
  await h.api.writeCachedBundle('/unused', h.bundle(), 'scope')
  h.setNow(1_000_000 + 93_600_000 - 1)
  assert.ok(await h.api.readCachedBundle('/unused', 'scope'))
  h.setNow(1_000_000 + 93_600_000)
  assert.equal(await h.api.readCachedBundle('/unused', 'scope'), null)

  const expiryHarness = harness('runtime', false, {
    HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_PLATFORM_BUNDLE_MAX_AGE_MS: '93600000',
    HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '93600000'
  })
  await expiryHarness.api.writeCachedBundle('/unused', expiryHarness.bundle(1_000_000, new Date(1_000_010).toISOString()), 'scope')
  expiryHarness.setNow(1_000_010)
  assert.equal(await expiryHarness.api.readCachedBundle('/unused', 'scope'), null)
})

test('non-test environments ignore the long freshness override', async () => {
  const h = harness('runtime', false, {
    HZY_PLATFORM_ENVIRONMENT: 'prod',
    HZY_PLATFORM_BUNDLE_MAX_AGE_MS: '93600000',
    HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '93600000'
  })
  await h.api.writeCachedBundle('/unused', h.bundle(), 'scope')
  h.setNow(1_300_000)
  assert.equal(await h.api.readCachedBundle('/unused', 'scope'), null)
})

test('enterprise Runtime cache rejects late older revision and legacy downgrade', async () => {
  const h = harness('runtime')
  const enterpriseEntitlement = {
    schemaVersion:'enterprise-entitlement.v1',productCode:'enterprise-full',tenantCode:'tenant',revision:2,
    status:'active',effectiveStatus:'active',effectiveFrom:'1970-01-01T00:00:00Z',end:{kind:'unlimited',evidenceReference:'migration'}
  }
  const latest = {...h.bundle(),payload:{policyRevision:2,enterpriseEntitlement}}
  await h.api.writeCachedBundle('/unused',latest,'scope')
  await assert.rejects(h.api.writeCachedBundle('/unused',{...latest,payload:{policyRevision:3,enterpriseEntitlement:{...enterpriseEntitlement,revision:1}}},'scope'),/rollback/)
  await assert.rejects(h.api.writeCachedBundle('/unused',h.bundle(),'scope'),/rollback/)
  assert.equal((await h.api.readCachedBundle('/unused','scope')).payload.enterpriseEntitlement.revision,2)
})

test('enterprise refuses ephemeral backends with 503 while legacy memory still works', async () => {
  const h = harness('memory')
  await h.api.writeCachedBundle('/unused',h.bundle(),'legacy')
  assert.ok(await h.api.readCachedBundle('/unused','legacy'))
  await assert.rejects(h.api.writeCachedBundle('/unused',{...h.bundle(),payload:{enterpriseEntitlement:{revision:1}}},'enterprise'),{statusCode:503})
})
