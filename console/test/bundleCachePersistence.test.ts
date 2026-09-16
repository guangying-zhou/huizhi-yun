import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as persistence from '../server/utils/persistentPolicyBundle.ts'

function harness() {
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
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'runtime', HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '300000',
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-integrity-key'
  } } } }
  const require = createRequire(import.meta.url)
  const exports: Record<string, any> = {}
  const source = ts.transpileModule(readFileSync(new URL('../server/utils/bundleCache.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(source, { exports, process, Buffer, Date: class extends Date { static now() { return now } }, require(name: string) {
    if (name === 'h3') return { getHeader: () => '' }
    if (name === 'nitropack/runtime') return { useEvent: () => event }
    if (name.includes('consolePolicyStore')) return { consolePolicyStore: () => store }
    if (name === './persistentPolicyBundle') return { ...persistence,
      readPolicyBundle: (s: persistence.PolicyObjectStore, scope: string, secret: string) => persistence.readPolicyBundle(s, scope, secret, now) }
    return require(name)
  } })
  const bundle = (at = now, expiresAt: string | null = null) => ({ status: 'active', tenantCode: 'tenant', deploymentCode: 'console',
    bundleVersion: String(at), payload: {}, cachedAt: new Date(at).toISOString(), expiresAt })
  return { api: exports, store, bundle, get gets() { return gets }, setNow(value: number) { now = value } }
}

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
