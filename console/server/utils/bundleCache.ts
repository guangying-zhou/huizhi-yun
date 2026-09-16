import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { getHeader } from 'h3'
import { useEvent } from 'nitropack/runtime'
import { consolePolicyStore } from '@hzy/foundation/server/utils/consolePolicyStore'
import { POLICY_MAX_AGE_MS, coalescePolicyRead, readPolicyBundle, storePolicyBundle } from './persistentPolicyBundle'

export type ActivationMode = 'pending' | 'active' | 'failed'

export interface CachedPolicyBundle {
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

function runtimeNumberValue(name: string, fallback: number) {
  const raw = stringValue(runtimeEnvValue(name))
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function memoryCacheTtlMs() {
  return Math.min(POLICY_MAX_AGE_MS, runtimeNumberValue('HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS', 30_000))
}

export function persistentPolicyStoreEnabled() {
  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase() === 'runtime'
}

function policyStore() {
  const store = consolePolicyStore(useEvent())
  const secret = runtimeEnvValue('HZY_TENANT_GATEWAY_INTERNAL_TOKEN') || runtimeEnvValue('HZY_CLOUDFLARE_INTERNAL_TOKEN')
  if (!secret) throw new Error('policy bundle integrity key unavailable')
  return { store, secret }
}

function runtimeCacheBackend(): 'file' | 'memory' | 'runtime' {
  if (persistentPolicyStoreEnabled()) return 'runtime'
  if (runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase() === 'r2') throw new Error('R2 policy backend retired; configure runtime storage')
  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase() === 'memory'
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

function memoryCacheSet<T>(key: string, value: T, deadline = Infinity) {
  memoryCache.set(key, { value, expiresAt: Math.min(deadline, Date.now() + memoryCacheTtlMs()) })
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

function getCloudflareEnv(): Record<string, unknown> {
  try {
    const event = useEvent() as unknown as CloudflareRuntimeEvent
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

function runtimeEnvValue(name: string) {
  const cloudflareEnv = getCloudflareEnv()
  return stringValue(cloudflareEnv[name] || process.env[name])
}

function trustTenantGatewayHeaders() {
  return isTruthy(runtimeEnvValue('HZY_CONSOLE_TRUST_TENANT_GATEWAY'))
    || isTruthy(runtimeEnvValue('CONSOLE_TRUST_TENANT_GATEWAY'))
}

function runtimeGatewayHeader(name: string) {
  try {
    if (!trustTenantGatewayHeaders()) {
      return ''
    }

    const event = useEvent()
    if (stringValue(getHeader(event, 'x-hzy-gateway')) !== 'tenant-gateway') {
      return ''
    }
    return stringValue(getHeader(event, name))
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

function resolveCacheScope(scopeOverride?: string | null) {
  const explicitScope = stringValue(scopeOverride)
  if (explicitScope) {
    return explicitScope
  }

  return runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_SCOPE')
    || runtimeGatewayHeader('x-hzy-deployment')
    || runtimeEnvValue('HZY_PLATFORM_DEPLOYMENT_CODE')
    || runtimeEnvValue('DEPLOYMENT_CODE')
}

function cacheKey(kind: 'policy_bundle' | 'activation_status', scopeOverride?: string | null): RuntimeCacheKey {
  const scope = resolveCacheScope(scopeOverride)
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

export function getRuntimeCacheDescriptor(cacheDir: string, scopeOverride?: string | null) {
  const scope = resolveCacheScope(scopeOverride)
  const backend = runtimeCacheBackend()
  return {
    backend,
    cacheDir: backend === 'file' ? cacheDir : null,
    table: backend === 'runtime' ? 'policy_bundle_snapshots' : null,
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

export function getCachedBundleInvalidReason(bundle: CachedPolicyBundle | null, now = Date.now()) {
  if (!bundle) {
    return 'policy bundle is missing'
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

function cachePersistentRecord(key: string, record: { syncedAt: number, value: CachedPolicyBundle }) {
  const now = Date.now()
  if (record.syncedAt > now || now - record.syncedAt >= POLICY_MAX_AGE_MS
    || getCachedBundleInvalidReason(record.value, now)) return null
  const current = memoryCacheGet<CachedPolicyBundle>(key)
  // An earlier read/sync may finish after a newer one in the same isolate.
  if (current && Date.parse(current.cachedAt) >= record.syncedAt
    && !getCachedBundleInvalidReason(current, now)) return current
  memoryCacheSet(key, record.value, Math.min(record.syncedAt + POLICY_MAX_AGE_MS,
    record.value.expiresAt ? Date.parse(record.value.expiresAt) : Infinity))
  return record.value
}

export async function readCachedBundle(cacheDir: string, scopeOverride?: string | null) {
  const key = cacheKey('policy_bundle', scopeOverride)
  const cached = memoryCacheGet<CachedPolicyBundle>(key.primary)
  if (cached) return persistentPolicyStoreEnabled() && getCachedBundleInvalidReason(cached) ? null : cached
  if (runtimeCacheBackend() === 'memory') return null
  if (persistentPolicyStoreEnabled()) {
    const { store, secret } = policyStore()
    const readKey = `${key.primary}:${createHash('sha256').update(secret).digest('hex')}`
    const record = await coalescePolicyRead(useEvent(), readKey, () =>
      readPolicyBundle<CachedPolicyBundle>(store, key.scope, secret))
    if (!record) return null
    if (getCachedBundleInvalidReason(record.value)) return null
    return cachePersistentRecord(key.primary, record)
  }
  const dir = resolveCacheDir(cacheDir)
  const value = await readJsonFile<CachedPolicyBundle>(join(dir, scopedFileName(BUNDLE_FILE, key.scope)))
  if (value) memoryCacheSet(key.primary, value)
  return value
}

export async function writeCachedBundle(cacheDir: string, bundle: CachedPolicyBundle, scopeOverride?: string | null) {
  const key = cacheKey('policy_bundle', scopeOverride)
  if (persistentPolicyStoreEnabled()) {
    const { store, secret } = policyStore()
    const syncedAt = Date.parse(bundle.cachedAt)
    if (!Number.isFinite(syncedAt) || getCachedBundleInvalidReason(bundle)) throw new Error('invalid policy bundle cannot be persisted')
    const winner = await storePolicyBundle(store, key.scope, secret, bundle, syncedAt)
    // CAS returns the authenticated winner, avoiding a full Runtime round trip.
    cachePersistentRecord(key.primary, winner)
    return
  }
  memoryCacheSet(key.primary, bundle)
  if (runtimeCacheBackend() === 'memory') return
  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(BUNDLE_FILE, key.scope)), JSON.stringify(bundle, null, 2), 'utf8')
}

export async function readActivationStatus(cacheDir: string, scopeOverride?: string | null) {
  if (persistentPolicyStoreEnabled()) {
    const bundle = await readCachedBundle(cacheDir, scopeOverride)
    return bundle
      ? { ...emptyActivationStatus(), mode: 'active' as const, activated: true,
          envValid: true, licenseValid: true, bundleReady: true, tenantCode: bundle.tenantCode,
          deploymentCode: bundle.deploymentCode, bundleVersion: bundle.bundleVersion,
          bundleHash: bundle.bundleHash, lastCheckedAt: bundle.cachedAt }
      : emptyActivationStatus()
  }
  const key = cacheKey('activation_status', scopeOverride)
  const cached = memoryCacheGet<ActivationStatus>(key.primary)
  if (cached) return cached
  if (runtimeCacheBackend() === 'memory') return emptyActivationStatus()
  const dir = resolveCacheDir(cacheDir)
  const value = await readJsonFile<ActivationStatus>(join(dir, scopedFileName(STATUS_FILE, key.scope))) || emptyActivationStatus()
  memoryCacheSet(key.primary, value)
  return value
}

export async function writeActivationStatus(cacheDir: string, status: ActivationStatus, scopeOverride?: string | null) {
  // Runtime readiness is derived from the single authenticated bundle record.
  if (persistentPolicyStoreEnabled()) return
  const key = cacheKey('activation_status', scopeOverride)
  memoryCacheSet(key.primary, status)
  if (runtimeCacheBackend() === 'memory') return
  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(STATUS_FILE, key.scope)), JSON.stringify(status, null, 2), 'utf8')
}

export async function patchActivationStatus(cacheDir: string, patch: Partial<ActivationStatus>, scopeOverride?: string | null) {
  const current = await readActivationStatus(cacheDir, scopeOverride)
  const next = {
    ...current,
    ...patch
  }
  await writeActivationStatus(cacheDir, next, scopeOverride)
  return next
}
