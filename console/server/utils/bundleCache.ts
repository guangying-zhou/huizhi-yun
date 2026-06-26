import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { getHeader } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { useEvent } from 'nitropack/runtime'
import { execute, queryRow } from '~~/server/utils/db'

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
const memoryCache = new Map<string, unknown>()
const warnedCacheBackends = new Set<string>()

interface RuntimeCacheRow extends RowDataPacket {
  payloadJson: string | Record<string, unknown> | null
}

interface RuntimeCacheKey {
  primary: string
  legacy: string | null
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

function normalizeCacheTableName() {
  const table = runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_TABLE') || 'console_runtime_cache'
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error(`invalid HZY_PLATFORM_BUNDLE_CACHE_TABLE: ${table}`)
  }
  return table
}

function useDbCacheBackend() {
  const backend = runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_BACKEND').toLowerCase()
  return backend === 'db'
    || isTruthy(runtimeEnvValue('HZY_CLOUDFLARE_RUNTIME'))
    || isTruthy(runtimeEnvValue('HZY_CLOUDFLARE_BUILD'))
}

function useLegacyDbCacheFallback() {
  return isTruthy(runtimeEnvValue('HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK'))
}

function warnCacheBackendOnce(key: string, message: string) {
  if (warnedCacheBackends.has(key)) return
  warnedCacheBackends.add(key)
  console.warn(message)
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

function readCachePayload<T>(value: RuntimeCacheRow['payloadJson']): T | null {
  if (!value) return null
  if (typeof value === 'string') {
    return JSON.parse(value) as T
  }
  return value as T
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
  if (!scope && useDbCacheBackend()) {
    throw new Error(
      'DB platform runtime cache requires HZY_PLATFORM_BUNDLE_CACHE_SCOPE or HZY_PLATFORM_DEPLOYMENT_CODE. '
      + 'Refusing to read or write legacy unscoped runtime cache keys.'
    )
  }

  return {
    primary: scope ? `${scope}:${kind}` : kind,
    legacy: scope ? kind : null,
    scope
  }
}

function scopedFileName(baseName: string, scopeOverride?: string | null) {
  const scope = stringValue(scopeOverride)
  if (!scope) return baseName

  const hash = createHash('sha256').update(scope).digest('hex').slice(0, 16)
  return `${baseName.replace(/\.json$/i, '')}.${hash}.json`
}

async function readDbCacheKey<T>(table: string, key: string) {
  const row = await queryRow<RuntimeCacheRow>(
    `SELECT payload_json AS payloadJson FROM \`${table}\` WHERE cache_key = ? LIMIT 1`,
    [key]
  )
  return readCachePayload<T>(row?.payloadJson || null)
}

async function readDbCache<T>(key: RuntimeCacheKey): Promise<T | null> {
  try {
    const table = normalizeCacheTableName()
    const value = await readDbCacheKey<T>(table, key.primary)
    if (value) {
      memoryCache.set(key.primary, value)
      return value
    }

    if (key.legacy && useLegacyDbCacheFallback()) {
      warnCacheBackendOnce(
        `db-legacy-fallback-${key.primary}`,
        `[console] platform runtime cache legacy fallback is enabled for ${key.primary}; disable HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK after scoped cache migration`
      )
      const legacyValue = await readDbCacheKey<T>(table, key.legacy)
      if (legacyValue) {
        memoryCache.set(key.primary, legacyValue)
        return legacyValue
      }
    }

    return memoryCache.has(key.primary) ? memoryCache.get(key.primary) as T : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnCacheBackendOnce(
      `db-read-${key.primary}`,
      `[console] platform runtime cache DB read failed for ${key.primary}, using memory fallback: ${message}`
    )
    return memoryCache.has(key.primary) ? memoryCache.get(key.primary) as T : null
  }
}

async function writeDbCache<T>(key: RuntimeCacheKey, value: T): Promise<void> {
  memoryCache.set(key.primary, value)

  try {
    const table = normalizeCacheTableName()
    await execute(
      `INSERT INTO \`${table}\` (cache_key, payload_json, updated_at)
       VALUES (?, CAST(? AS JSON), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         payload_json = VALUES(payload_json),
         updated_at = UTC_TIMESTAMP()`,
      [key.primary, JSON.stringify(value)]
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnCacheBackendOnce(
      `db-write-${key.primary}`,
      `[console] platform runtime cache DB write failed for ${key.primary}, using memory fallback: ${message}`
    )
  }
}

export function getRuntimeCacheDescriptor(cacheDir: string, scopeOverride?: string | null) {
  const backend = useDbCacheBackend() ? 'db' : 'file'
  const scope = resolveCacheScope(scopeOverride)
  return {
    backend,
    cacheDir,
    table: backend === 'db' ? normalizeCacheTableName() : null,
    scope: scope || null,
    legacyFallback: backend === 'db' ? useLegacyDbCacheFallback() : false
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

export async function readCachedBundle(cacheDir: string, scopeOverride?: string | null) {
  if (useDbCacheBackend()) {
    return readDbCache<CachedPolicyBundle>(cacheKey('policy_bundle', scopeOverride))
  }

  const dir = resolveCacheDir(cacheDir)
  return readJsonFile<CachedPolicyBundle>(join(dir, scopedFileName(BUNDLE_FILE, scopeOverride)))
}

export async function writeCachedBundle(cacheDir: string, bundle: CachedPolicyBundle, scopeOverride?: string | null) {
  if (useDbCacheBackend()) {
    await writeDbCache(cacheKey('policy_bundle', scopeOverride), bundle)
    return
  }

  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(BUNDLE_FILE, scopeOverride)), JSON.stringify(bundle, null, 2), 'utf8')
}

export async function readActivationStatus(cacheDir: string, scopeOverride?: string | null) {
  if (useDbCacheBackend()) {
    return await readDbCache<ActivationStatus>(cacheKey('activation_status', scopeOverride)) || emptyActivationStatus()
  }

  const dir = resolveCacheDir(cacheDir)
  return await readJsonFile<ActivationStatus>(join(dir, scopedFileName(STATUS_FILE, scopeOverride))) || emptyActivationStatus()
}

export async function writeActivationStatus(cacheDir: string, status: ActivationStatus, scopeOverride?: string | null) {
  if (useDbCacheBackend()) {
    await writeDbCache(cacheKey('activation_status', scopeOverride), status)
    return
  }

  const dir = await ensureCacheDir(cacheDir)
  const { writeFile } = await importFs()
  await writeFile(join(dir, scopedFileName(STATUS_FILE, scopeOverride)), JSON.stringify(status, null, 2), 'utf8')
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
