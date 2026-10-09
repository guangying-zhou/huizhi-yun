import { evaluateEnterpriseEntitlement } from './enterpriseEntitlement'
import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { createError, getHeader, type H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime'
import { consolePolicyStore } from '@hzy/foundation/server/utils/consolePolicyStore'
import type { PolicyEnvelope } from '@hzy/authz-core/policy-envelope'
import { POLICY_MAX_AGE_MS, boundedPolicyMaxAgeMs, coalescePolicyRead, readPolicyBundle, storePolicyBundle } from './persistentPolicyBundle'

export type ActivationMode = 'pending' | 'active' | 'failed'

export interface CachedPolicyBundle {
  verifiedEnvelope?: PolicyEnvelope
  // Verified-runtime reads only: 'grace' means Platform is unreachable and the
  // last authentic envelope is served under the outage-grace rule.
  policyValidity?: 'valid' | 'grace'
  tenantCode: string
  deploymentCode: string
  bundleVersion: string
  bundleHash: string
  schemaVersion: string
  status: string
  generatedAt: string | null
  expiresAt: string | null
  signature: string
  kid: string
  alg: string
  signedAt: string | null
  payload: Record<string, unknown>
  cachedAt: string
}

export interface ActivationStatus {
  mode: ActivationMode
  activated: boolean
  envValid: boolean
  licenseValid: boolean
  bundleReady: boolean
  tenantCode: string | null
  deploymentCode: string | null
  bundleVersion: string | null
  bundleHash: string | null
  lastCheckedAt: string | null
  lastActivatedAt: string | null
  lastHeartbeatAt: string | null
  lastError: string | null
}

const BUNDLE_FILE = 'policy-bundle.json'
const STATUS_FILE = 'activation-status.json'

// Cloudflare 使用 isolate 内存；PM2 使用文件缓存并在前面加一层短 TTL 内存缓存。
// 这里仅缓存 Platform 下发的签名策略包和激活状态，不承载租户业务数据。
interface MemoryCacheEntry {
  value: unknown
  expiresAt: number
}
const memoryCache = new Map<string, MemoryCacheEntry>()

function runtimeNumberValue(name: string, fallback: number, event?: H3Event) {
  const raw = stringValue(runtimeEnvValue(name, event))
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function policyMaxAgeMs(event?: H3Event) {
  // A longer stale-policy window is only supported for the isolated test
  // environment. Production remains fail-closed at the established five-minute
  // limit even when an inherited variable is accidentally present.
  if (runtimeEnvValue('HZY_PLATFORM_ENVIRONMENT', event).toLowerCase() !== 'test') return POLICY_MAX_AGE_MS
  return boundedPolicyMaxAgeMs(runtimeEnvValue('HZY_PLATFORM_BUNDLE_MAX_AGE_MS', event))
}

export function policyMemoryCacheTtlMs(event?: H3Event) {
  return Math.min(policyMaxAgeMs(event), runtimeNumberValue('HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS', 30_000, event))
}

export function persistentPolicyStoreEnabled(event?: H3Event) {
  return verifiedPolicyStoreEnabled(event) || runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND', event).toLowerCase() === 'runtime'
}

export function verifiedPolicyStoreEnabled(event?: H3Event) {
  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND', event).toLowerCase() === 'verified-runtime'
}

function policyStore(event?: H3Event) {
  const store = consolePolicyStore(event || useEvent())
  const secret = runtimeEnvValue('HZY_TENANT_GATEWAY_INTERNAL_TOKEN', event) || runtimeEnvValue('HZY_CLOUDFLARE_INTERNAL_TOKEN', event)
  if (!secret) throw new Error('policy bundle integrity key unavailable')
  return { store, secret }
}

function runtimeCacheBackend(event?: H3Event): 'file' | 'memory' | 'runtime' | 'verified-runtime' {
  if (verifiedPolicyStoreEnabled(event)) return 'verified-runtime'
  if (persistentPolicyStoreEnabled(event)) return 'runtime'
  if (runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND', event).toLowerCase() === 'r2') throw new Error('R2 policy backend retired; configure runtime storage')
  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND', event).toLowerCase() === 'memory'
    ? 'memory'
    : 'file'
}

function memoryCacheGet<T>(key: string): T | null {
  const entry = memoryCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key)
    return null
  }
  return entry.value as T
}

function memoryCacheSet<T>(key: string, value: T, deadline = Infinity, event?: H3Event) {
  memoryCache.set(key, { value, expiresAt: Math.min(deadline, Date.now() + policyMemoryCacheTtlMs(event)) })
}

interface RuntimeCacheKey {
  primary: string
  scope: string
}

type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: Record<string, unknown>
    }
    _platform?: {
      cloudflare?: {
        env?: Record<string, unknown>
      }
    }
    nitro?: {
      env?: Record<string, unknown>
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: Record<string, unknown>
      }
    }
  }
}

type CloudflareGlobal = typeof globalThis & {
  __env__?: Record<string, unknown>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function isTruthy(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(stringValue(value).toLowerCase())
}

function getCloudflareEnv(inputEvent?: H3Event): Record<string, unknown> {
  try {
    const event = (inputEvent || useEvent()) as unknown as CloudflareRuntimeEvent
    return event.context?.cloudflare?.env
      || event.context?._platform?.cloudflare?.env
      || event.context?.nitro?.env
      || event.req?.runtime?.cloudflare?.env
      || (globalThis as CloudflareGlobal).__env__
      || {}
  } catch {
    return (globalThis as CloudflareGlobal).__env__ || {}
  }
}

function runtimeEnvValue(name: string, event?: H3Event) {
  const cloudflareEnv = getCloudflareEnv(event)
  return stringValue(cloudflareEnv[name] || process.env[name])
}

function trustTenantGatewayHeaders(event?: H3Event) {
  return isTruthy(runtimeEnvValue('HZY_CONSOLE_TRUST_TENANT_GATEWAY', event))
    || isTruthy(runtimeEnvValue('CONSOLE_TRUST_TENANT_GATEWAY', event))
}

function runtimeGatewayHeader(name: string, event?: H3Event) {
  try {
    if (!trustTenantGatewayHeaders(event)) {
      return ''
    }

    const requestEvent = event || useEvent()
    if (stringValue(getHeader(requestEvent, 'x-hzy-gateway')) !== 'tenant-gateway') {
      return ''
    }
    return stringValue(getHeader(requestEvent, name))
  } catch {
    return ''
  }
}

async function importFs() {
  return await import('node:fs/promises')
}

function resolveCacheDir(cacheDir: string) {
  return isAbsolute(cacheDir) ? cacheDir : resolve(process.cwd(), cacheDir)
}

async function ensureCacheDir(cacheDir: string) {
  const dir = resolveCacheDir(cacheDir)
  const { mkdir } = await importFs()
  await mkdir(dir, { recursive: true })
  return dir
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const { readFile } = await importFs()
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

function resolveCacheScope(scopeOverride?: string | null, event?: H3Event) {
  const explicitScope = stringValue(scopeOverride)
  if (explicitScope) {
    return explicitScope
  }

  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_SCOPE', event)
    || runtimeGatewayHeader('x-hzy-deployment', event)
    || runtimeEnvValue('HZY_PLATFORM_DEPLOYMENT_CODE', event)
    || runtimeEnvValue('DEPLOYMENT_CODE', event)
}

function cacheKey(kind: 'policy_bundle' | 'activation_status', scopeOverride?: string | null, event?: H3Event): RuntimeCacheKey {
  const scope = resolveCacheScope(scopeOverride, event)
  return {
    primary: scope ? `${scope}:${kind}` : kind,
    scope
  }
}

function scopedFileName(baseName: string, scopeOverride?: string | null) {
  const scope = stringValue(scopeOverride)
  if (!scope) return baseName

  const hash = createHash('sha256').update(scope).digest('hex').slice(0, 16)
  return `${baseName.replace(/\.json$/i, '')}.${hash}.json`
}

export function getRuntimeCacheDescriptor(cacheDir: string, scopeOverride?: string | null, event?: H3Event) {
  const scope = resolveCacheScope(scopeOverride, event)
  const backend = runtimeCacheBackend(event)
  return {
    backend,
    cacheDir: backend === 'file' ? cacheDir : null,
    table: backend === 'verified-runtime' ? 'verified_policy_snapshots' : backend === 'runtime' ? 'policy_bundle_snapshots' : null,
    scope: scope || null,
    legacyFallback: false
  }
}

export function emptyActivationStatus(): ActivationStatus {
  return {
    mode: 'pending',
    activated: false,
    envValid: false,
    licenseValid: false,
    bundleReady: false,
    tenantCode: null,
    deploymentCode: null,
    bundleVersion: null,
    bundleHash: null,
    lastCheckedAt: null,
    lastActivatedAt: null,
    lastHeartbeatAt: null,
    lastError: null
  }
}

export function getCachedBundleInvalidReason(bundle: CachedPolicyBundle | null, now = Date.now(), maxAgeMs = policyMaxAgeMs()) {
  if (!bundle) {
    return 'policy bundle is missing'
  }

  const enterprise = evaluateEnterpriseEntitlement(bundle.payload, bundle.tenantCode, now)
  if (enterprise.reason === 'enterprise_entitlement_invalid') return enterprise.reason
  // A verified-runtime authorization view (policyValidity set) already carries
  // its lifecycle in expiresAt: signed lease, outage grace and policy expiry.
  // Its cachedAt is the Runtime acceptance time, not a legacy sync freshness.
  if (enterprise.mode === 'enterprise' && !bundle.policyValidity) {
    const syncedAt = Date.parse(bundle.cachedAt)
    if (!Number.isFinite(syncedAt) || syncedAt > now || now - syncedAt >= maxAgeMs) return 'enterprise_entitlement_refresh_required'
  }

  if (bundle.status && bundle.status !== 'active') {
    return `policy bundle is not active: ${bundle.status}`
  }

  if (bundle.expiresAt) {
    const expiresAtMs = new Date(bundle.expiresAt).getTime()
    if (Number.isNaN(expiresAtMs)) {
      return `policy bundle expiresAt is invalid: ${bundle.expiresAt}`
    }
    if (expiresAtMs <= now) {
      return `policy bundle expired: ${bundle.expiresAt}`
    }
  }

  return null
}

function cachePersistentRecord(key: string, record: { syncedAt: number, value: CachedPolicyBundle }, event?: H3Event) {
  const now = Date.now()
  const maxAgeMs = policyMaxAgeMs(event)
  if (record.syncedAt > now || now - record.syncedAt >= maxAgeMs
    || getCachedBundleInvalidReason(record.value, now, maxAgeMs)) return null
  const current = memoryCacheGet<CachedPolicyBundle>(key)
  // An earlier read/sync may finish after a newer one in the same isolate.
  const advanced = current && Object.hasOwn(record.value.payload, 'enterpriseEntitlement')
    && Number(record.value.payload.policyRevision) > Number(current.payload.policyRevision)
  if (current && (Date.parse(current.cachedAt) > record.syncedAt || (Date.parse(current.cachedAt) === record.syncedAt && !advanced))
    && !getCachedBundleInvalidReason(current, now, maxAgeMs)) return current
  memoryCacheSet(key, record.value, Math.min(record.syncedAt + maxAgeMs,
    record.value.expiresAt ? Date.parse(record.value.expiresAt) : Infinity), event)
  return record.value
}

function requireEnterprisePersistentBackend(bundle: CachedPolicyBundle, event?: H3Event) {
  if (Object.hasOwn(bundle.payload, 'enterpriseEntitlement') && !persistentPolicyStoreEnabled(event)) {
    throw createError({ statusCode: 503, message: 'Enterprise entitlement requires Runtime policy persistence', data: { code: 'enterprise_policy_persistence_required' } })
  }
}

export async function readCachedBundle(cacheDir: string, scopeOverride?: string | null, event?: H3Event) {
  // Never consume legacy memory/HMAC state in the verified backend. Reads go
  // through the authenticated Runtime; a verified view may be reused across
  // requests for the memory TTL but never past its signed deadline.
  if (verifiedPolicyStoreEnabled(event)) {
    const { readVerifiedConsolePolicy } = await import('./verifiedPolicyRuntime')
    return readVerifiedConsolePolicy(event)
  }
  const key = cacheKey('policy_bundle', scopeOverride, event)
  const maxAgeMs = policyMaxAgeMs(event)
  const cached = memoryCacheGet<CachedPolicyBundle>(key.primary)
  if (cached) requireEnterprisePersistentBackend(cached, event)
  if (cached) return (persistentPolicyStoreEnabled(event) || Object.hasOwn(cached.payload, 'enterpriseEntitlement')) && getCachedBundleInvalidReason(cached, Date.now(), maxAgeMs) ? null : cached
  if (runtimeCacheBackend(event) === 'memory') return null
  if (persistentPolicyStoreEnabled(event)) {
    const { store, secret } = policyStore(event)
    const readKey = `${key.primary}:${createHash('sha256').update(secret).digest('hex')}`
    const record = await coalescePolicyRead(event || useEvent(), readKey, () =>
      readPolicyBundle<CachedPolicyBundle>(store, key.scope, secret, Date.now(), maxAgeMs))
    if (!record) return null
    if (getCachedBundleInvalidReason(record.value, Date.now(), maxAgeMs)) return null
    return cachePersistentRecord(key.primary, record, event)
  }
  const dir = resolveCacheDir(cacheDir)
  const value = await readJsonFile<CachedPolicyBundle>(join(dir, scopedFileName(BUNDLE_FILE, key.scope)))
  if (value) requireEnterprisePersistentBackend(value)
  if (value && Object.hasOwn(value.payload, 'enterpriseEntitlement') && getCachedBundleInvalidReason(value, Date.now(), maxAgeMs)) return null
  if (value) memoryCacheSet(key.primary, value, Infinity, event)
  return value
}

export async function writeCachedBundle(cacheDir: string, bundle: CachedPolicyBundle, scopeOverride?: string | null, event?: H3Event) {
  if (verifiedPolicyStoreEnabled(event)) {
    const { writeVerifiedConsolePolicy } = await import('./verifiedPolicyRuntime')
    return writeVerifiedConsolePolicy(bundle, event)
  }
  requireEnterprisePersistentBackend(bundle, event)
  const key = cacheKey('policy_bundle', scopeOverride, event)
  const maxAgeMs = policyMaxAgeMs(event)
  if (Object.hasOwn(bundle.payload, 'enterpriseEntitlement') && getCachedBundleInvalidReason(bundle, Date.now(), maxAgeMs)) throw new Error('invalid enterprise bundle cannot be cached')
  const current = memoryCacheGet<CachedPolicyBundle>(key.primary)
  if (current && Object.hasOwn(current.payload, 'enterpriseEntitlement')) {
    const currentRevision = Number((current.payload.enterpriseEntitlement as Record<string, unknown>)?.revision)
    const nextRevision = Number((bundle.payload.enterpriseEntitlement as Record<string, unknown>)?.revision)
    if (bundle.tenantCode !== current.tenantCode || !Number.isSafeInteger(nextRevision) || nextRevision < currentRevision
      || Date.parse(bundle.cachedAt) < Date.parse(current.cachedAt)) throw new Error('enterprise bundle rollback rejected')
  }
  if (persistentPolicyStoreEnabled(event)) {
    const { store, secret } = policyStore(event)
    const syncedAt = Date.parse(bundle.cachedAt)
    if (!Number.isFinite(syncedAt) || getCachedBundleInvalidReason(bundle, Date.now(), maxAgeMs)) throw new Error('invalid policy bundle cannot be persisted')
    const winner = await storePolicyBundle(store, key.scope, secret, bundle, syncedAt)
    // CAS returns the authenticated winner, avoiding a full Runtime round trip.
    cachePersistentRecord(key.primary, winner, event)
    return
  }
  memoryCacheSet(key.primary, bundle, Infinity, event)
  if (runtimeCacheBackend(event) === 'memory') return
  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(BUNDLE_FILE, key.scope)), JSON.stringify(bundle, null, 2), 'utf8')
}

export async function readActivationStatus(cacheDir: string, scopeOverride?: string | null, event?: H3Event) {
  if (persistentPolicyStoreEnabled(event)) {
    const bundle = await readCachedBundle(cacheDir, scopeOverride, event)
    return bundle
      ? { ...emptyActivationStatus(), mode: 'active' as const, activated: true,
          envValid: true, licenseValid: true, bundleReady: true, tenantCode: bundle.tenantCode,
          deploymentCode: bundle.deploymentCode, bundleVersion: bundle.bundleVersion,
          bundleHash: bundle.bundleHash, lastCheckedAt: bundle.cachedAt }
      : emptyActivationStatus()
  }
  const key = cacheKey('activation_status', scopeOverride, event)
  const cached = memoryCacheGet<ActivationStatus>(key.primary)
  if (cached) return cached
  if (runtimeCacheBackend(event) === 'memory') return emptyActivationStatus()
  const dir = resolveCacheDir(cacheDir)
  const value = await readJsonFile<ActivationStatus>(join(dir, scopedFileName(STATUS_FILE, key.scope))) || emptyActivationStatus()
  memoryCacheSet(key.primary, value)
  return value
}

export async function writeActivationStatus(cacheDir: string, status: ActivationStatus, scopeOverride?: string | null, event?: H3Event) {
  // Runtime readiness is derived from the single authenticated bundle record.
  if (persistentPolicyStoreEnabled(event)) return
  const key = cacheKey('activation_status', scopeOverride, event)
  memoryCacheSet(key.primary, status)
  if (runtimeCacheBackend(event) === 'memory') return
  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(STATUS_FILE, key.scope)), JSON.stringify(status, null, 2), 'utf8')
}

export async function patchActivationStatus(cacheDir: string, patch: Partial<ActivationStatus>, scopeOverride?: string | null, event?: H3Event) {
  const current = await readActivationStatus(cacheDir, scopeOverride, event)
  const next = {
    ...current,
    ...patch
  }
  await writeActivationStatus(cacheDir, next, scopeOverride, event)
  return next
}
