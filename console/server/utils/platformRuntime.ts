import { createHash, createPublicKey, timingSafeEqual, verify as nodeVerify } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { getHeader, type H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime'
import {
  type ActivationStatus,
  type CachedPolicyBundle,
  emptyActivationStatus,
  getCachedBundleInvalidReason,
  patchActivationStatus,
  readActivationStatus,
  readCachedBundle,
  writeCachedBundle
} from '~~/server/utils/bundleCache'
import { materializeAuthClientsFromBundle } from '~~/server/utils/authClients'
import { collectAuthRuntimeHealthSummary } from '~~/server/utils/authRuntimeHealth'
import type { AuthClientMaterializeResult } from '~~/server/utils/authClients'
import { resolvePlatformBundleSigningKey } from '~~/server/utils/platformSigningKeyResolver'

type JsonValue
  = | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

interface LicenseToken {
  schemaVersion: string
  payload: Record<string, unknown>
  signature: string
  kid: string
  alg: string
  signedAt: string
}

type CloudflareRuntimeEnv = Record<string, string | undefined>
type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}

type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareRuntimeEnv
}

interface PlatformBundleEnvelope {
  code?: number
  success?: boolean
  data: PlatformBundleResponse
}

interface PlatformBundleResponse {
  deploymentId: string
  tenantCode: string
  bundleVersion: string
  bundleHash: string
  generatedAt: string | null
  expiresAt: string | null
  schemaVersion: string
  status: string
  signature: string | null
  kid: string | null
  alg: string | null
  signedAt: string | null
  bundle: Record<string, unknown>
}

interface HeartbeatEnvelope {
  code?: number
  data?: {
    actions?: Array<{ type: string, version: string }>
    nextSuggestedHeartbeatAt?: string
  }
}

interface PlatformTenantProfileEnvelope {
  code: number
  data: PlatformTenantProfileResponse
}

export interface PlatformTenantProfileResponse {
  tenantCode: string
  tenantName: string
  displayName?: string | null
  tenantType?: string | null
  primaryDomain?: string | null
  status: string
  orgProfile?: {
    orgName: string
    orgShortName?: string | null
    displayName?: string | null
    legalName?: string | null
    unifiedSocialCreditCode?: string | null
    logoPath?: string | null
    websiteUrl?: string | null
    industryCode?: string | null
    countryCode?: string | null
    timezone?: string | null
    locale?: string | null
    currencyCode?: string | null
    contactName?: string | null
    contactEmail?: string | null
    contactMobile?: string | null
    addressText?: string | null
  } | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface PlatformRuntimeConfig {
  activationMode: ConsoleActivationMode
  baseUrl: string
  tenantCode: string
  deploymentCode: string
  environment: string
  runtimeToken: string
  platformServiceToken: string
  signingKid: string
  signingPubkey: string
  licenseToken: string
  licensePath: string
  bundleCacheDir: string
  heartbeatIntervalMs: number
  runMode: string
  runtimeEnabled: boolean
  heartbeatEnabled: boolean
  bundleRefreshOnBoot: boolean
  authClientMaterializeEnabled: boolean
  backgroundJobsEnabled: boolean
  devPolicyBypassEnabled: boolean
  trustTenantGateway: boolean
  vaultMasterKey: string
}

export interface ConsoleRuntimeModeConfig {
  activationMode: ConsoleActivationMode
  runMode: string
  runtimeEnabled: boolean
  heartbeatEnabled: boolean
  bundleRefreshOnBoot: boolean
  authClientMaterializeEnabled: boolean
  backgroundJobsEnabled: boolean
  devPolicyBypassEnabled: boolean
  trustTenantGateway: boolean
}

export interface VerifiedLicense {
  token: LicenseToken
  payload: Record<string, unknown>
}

export type ConsoleActivationMode = 'standalone' | 'managed-cloud-multitenant'

export interface ManagedCloudTenantContext {
  tenantCode: string
  deploymentCode: string
  environment: string
  cacheScope: string
  source: 'tenant-gateway'
}

export interface RefreshBundleResult {
  ok: boolean
  status: ActivationStatus
  bundle: CachedPolicyBundle | null
  authClientMaterialization?: AuthClientMaterializeResult | null
  error: string | null
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event?: (H3Event & CloudflareRuntimeEvent) | null) {
  const runtimeEvent = event || getRuntimeEvent()
  return runtimeEvent?.context?.cloudflare?.env
    || runtimeEvent?.context?._platform?.cloudflare?.env
    || runtimeEvent?.context?.nitro?.env
    || runtimeEvent?.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function getRuntimeEvent() {
  try {
    return useEvent() as unknown as H3Event & CloudflareRuntimeEvent
  } catch {
    return null
  }
}

function runtimeEnvValueForEvent(event: (H3Event & CloudflareRuntimeEvent) | null, ...keys: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const key of keys) {
    const value = normalizeString(cloudflareEnv[key] || process.env[key])
    if (value) return value
  }
  return ''
}

function runtimeEnvValue(...keys: string[]) {
  return runtimeEnvValueForEvent(null, ...keys)
}

function runtimeConfigValue(record: Record<string, unknown>, key: string) {
  return normalizeString(record[key])
}

function parseRuntimeBoolean(value: string, fallback: boolean) {
  if (!value) return fallback
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
  return fallback
}

function normalizeActivationMode(value: unknown): ConsoleActivationMode {
  const mode = normalizeString(value).toLowerCase()
  if (mode === 'managed-cloud-multitenant' || mode === 'managed_cloud_multitenant' || mode === 'cloudflare-multitenant') {
    return 'managed-cloud-multitenant'
  }
  return 'standalone'
}

function normalizeEnvironment(value: unknown) {
  const normalized = normalizeString(value || 'prod').toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : 'prod'
}

function runtimeBooleanForEvent(
  event: (H3Event & CloudflareRuntimeEvent) | null,
  configuredValue: unknown,
  envKeys: string[],
  fallback: boolean
) {
  return parseRuntimeBoolean(
    runtimeEnvValueForEvent(event, ...envKeys) || normalizeString(configuredValue),
    fallback
  )
}

function trustTenantGatewayHeaders(event: (H3Event & CloudflareRuntimeEvent) | null) {
  return runtimeBooleanForEvent(
    event,
    null,
    ['HZY_CONSOLE_TRUST_TENANT_GATEWAY', 'CONSOLE_TRUST_TENANT_GATEWAY'],
    false
  )
}

function constantTimeEquals(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function tenantGatewayToken(event: (H3Event & CloudflareRuntimeEvent) | null) {
  return runtimeEnvValueForEvent(
    event,
    'HZY_CLOUDFLARE_INTERNAL_TOKEN',
    'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
    'HZY_CONSOLE_TENANT_GATEWAY_TOKEN',
    'TENANT_GATEWAY_INTERNAL_TOKEN'
  )
}

export function isManagedCloudMultitenantActivation(event?: H3Event | null) {
  const runtimeEvent = (event as (H3Event & CloudflareRuntimeEvent) | undefined) || getRuntimeEvent()
  const config = useRuntimeConfig(event || undefined)
  const consoleRuntime = getRecord(config.consoleRuntime) || {}
  return normalizeActivationMode(
    runtimeEnvValueForEvent(runtimeEvent, 'HZY_CONSOLE_ACTIVATION_MODE', 'CONSOLE_ACTIVATION_MODE')
    || normalizeString(consoleRuntime.activationMode)
  ) === 'managed-cloud-multitenant'
}

export function isTrustedTenantGatewayRequest(event: H3Event | null) {
  const runtimeEvent = event as (H3Event & CloudflareRuntimeEvent) | null
  if (!runtimeEvent || normalizeString(getHeader(runtimeEvent, 'x-hzy-gateway')) !== 'tenant-gateway') {
    return false
  }

  const expectedToken = tenantGatewayToken(runtimeEvent)
  if (expectedToken) {
    return constantTimeEquals(normalizeString(getHeader(runtimeEvent, 'x-hzy-gateway-token')), expectedToken)
  }

  if (isManagedCloudMultitenantActivation(runtimeEvent)) {
    return false
  }

  return trustTenantGatewayHeaders(runtimeEvent)
}

function tenantGatewayHeader(event: (H3Event & CloudflareRuntimeEvent) | null, name: string) {
  if (!event || !isTrustedTenantGatewayRequest(event)) {
    return ''
  }

  return normalizeString(getHeader(event, name))
}

export function resolveManagedCloudTenantContext(event?: H3Event | null): ManagedCloudTenantContext | null {
  const runtimeEvent = (event as (H3Event & CloudflareRuntimeEvent) | undefined) || getRuntimeEvent()
  if (!runtimeEvent || !isManagedCloudMultitenantActivation(runtimeEvent) || !isTrustedTenantGatewayRequest(runtimeEvent)) {
    return null
  }

  const tenantCode = tenantGatewayHeader(runtimeEvent, 'x-hzy-tenant')
  if (!tenantCode) {
    return null
  }

  const environment = normalizeEnvironment(
    tenantGatewayHeader(runtimeEvent, 'x-hzy-environment')
    || runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_ENVIRONMENT', 'HZY_DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_ENVIRONMENT')
    || 'prod'
  )
  const deploymentCode = tenantGatewayHeader(runtimeEvent, 'x-hzy-deployment')

  return {
    tenantCode,
    deploymentCode,
    environment,
    cacheScope: `managed-cloud-console:${environment}:${tenantCode}`,
    source: 'tenant-gateway'
  }
}

export function resolvePlatformRuntimeCacheScope(config: Pick<PlatformRuntimeConfig, 'activationMode' | 'tenantCode' | 'environment'>, event?: H3Event | null) {
  if (config.activationMode !== 'managed-cloud-multitenant') {
    return null
  }

  const context = resolveManagedCloudTenantContext(event)
  if (context) {
    return context.cacheScope
  }

  const tenantCode = normalizeString(config.tenantCode)
  const environment = normalizeEnvironment(config.environment)
  return tenantCode ? `managed-cloud-console:${environment}:${tenantCode}` : 'managed-cloud-console:global'
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, '')
}

function isSuccessfulPlatformBundleEnvelope(response: PlatformBundleEnvelope) {
  return response.code === 0 || response.success === true
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, '\n')
}

function resolvePath(path: string) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

export function resolvePlatformBundleCacheDir(event?: H3Event) {
  const runtimeEvent = (event as (H3Event & CloudflareRuntimeEvent) | undefined) || getRuntimeEvent()
  const config = useRuntimeConfig(event)
  const platform = getRecord(config.platform) || {}
  const configured = runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_BUNDLE_CACHE_DIR', 'PLATFORM_BUNDLE_CACHE_DIR')
    || normalizeString(platform.bundleCacheDir)
  if (configured) {
    return configured
  }

  return loadConsoleRuntimeMode(event).runMode === 'dev'
    ? '.data/platform-runtime-dev'
    : '.data/platform-runtime'
}

export function loadConsoleRuntimeMode(event?: H3Event): ConsoleRuntimeModeConfig {
  const runtimeEvent = (event as (H3Event & CloudflareRuntimeEvent) | undefined) || getRuntimeEvent()
  const config = useRuntimeConfig(event)
  const consoleRuntime = getRecord(config.consoleRuntime) || {}
  const platform = getRecord(config.platform) || {}
  const activationMode = normalizeActivationMode(
    runtimeEnvValueForEvent(runtimeEvent, 'HZY_CONSOLE_ACTIVATION_MODE', 'CONSOLE_ACTIVATION_MODE')
    || runtimeConfigValue(consoleRuntime, 'activationMode')
  )
  const runMode = runtimeEnvValueForEvent(runtimeEvent, 'HZY_CONSOLE_RUN_MODE', 'CONSOLE_RUN_MODE')
    || runtimeConfigValue(consoleRuntime, 'runMode')
    || (process.env.NODE_ENV === 'development' ? 'dev' : 'prod')
  const isDevMode = runMode === 'dev'
  const runtimeEnabled = runtimeBooleanForEvent(
    runtimeEvent,
    platform.runtimeEnabled,
    ['HZY_PLATFORM_RUNTIME_ENABLED', 'PLATFORM_RUNTIME_ENABLED'],
    !isDevMode
  )
  const heartbeatEnabled = runtimeEnabled && runtimeBooleanForEvent(
    runtimeEvent,
    platform.heartbeatEnabled,
    ['HZY_PLATFORM_HEARTBEAT_ENABLED', 'PLATFORM_HEARTBEAT_ENABLED'],
    true
  )
  const bundleRefreshOnBoot = runtimeEnabled && runtimeBooleanForEvent(
    runtimeEvent,
    platform.bundleRefreshOnBoot,
    ['HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT', 'PLATFORM_BUNDLE_REFRESH_ON_BOOT'],
    true
  )
  const authClientMaterializeEnabled = runtimeEnabled && runtimeBooleanForEvent(
    runtimeEvent,
    platform.authClientMaterialize,
    ['HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE', 'PLATFORM_AUTH_CLIENT_MATERIALIZE'],
    true
  )
  const backgroundJobsEnabled = runtimeBooleanForEvent(
    runtimeEvent,
    consoleRuntime.backgroundJobsEnabled,
    ['HZY_CONSOLE_BACKGROUND_JOBS_ENABLED', 'CONSOLE_BACKGROUND_JOBS_ENABLED'],
    !isDevMode
  )
  const devPolicyBypassEnabled = isDevMode && !runtimeEnabled && runtimeBooleanForEvent(
    runtimeEvent,
    consoleRuntime.devPolicyBypass,
    ['HZY_CONSOLE_DEV_POLICY_BYPASS', 'CONSOLE_DEV_POLICY_BYPASS'],
    true
  )
  const trustTenantGateway = trustTenantGatewayHeaders(runtimeEvent)

  return {
    activationMode,
    runMode,
    runtimeEnabled,
    heartbeatEnabled,
    bundleRefreshOnBoot,
    authClientMaterializeEnabled,
    backgroundJobsEnabled,
    devPolicyBypassEnabled,
    trustTenantGateway
  }
}

function runtimeDisabledActivationStatus(): ActivationStatus {
  return {
    ...emptyActivationStatus(),
    mode: 'active',
    activated: true,
    envValid: true,
    licenseValid: true,
    bundleReady: false,
    lastCheckedAt: new Date().toISOString()
  }
}

function normalizeVaultMasterKey(value: string) {
  const base64 = Buffer.from(value, 'base64')
  if (base64.length >= 32) {
    return base64.subarray(0, 32)
  }

  const hex = Buffer.from(value, 'hex')
  if (hex.length >= 32) {
    return hex.subarray(0, 32)
  }

  return createHash('sha256').update(value).digest()
}

function fingerprintVaultMasterKey(value: string) {
  return `sha256:${createHash('sha256').update(normalizeVaultMasterKey(value)).digest('hex').slice(0, 32)}`
}

function verifyLicenseVaultFingerprint(payload: Record<string, unknown>, vaultMasterKey: string) {
  const vault = getRecord(payload.vault)
  if (!vault) {
    return
  }

  const expected = normalizeString(vault.masterKeyFingerprint)
  const required = vault.masterKeyRequired === true || Boolean(expected)
  if (!required) {
    return
  }

  const algorithm = normalizeString(vault.algorithm)
  if (algorithm && algorithm !== 'aes-256-gcm') {
    throw new Error(`unsupported vault algorithm: ${algorithm}`)
  }

  if (!vaultMasterKey) {
    throw new Error('Console vault master key is required by license but is not configured')
  }

  const actual = fingerprintVaultMasterKey(vaultMasterKey)
  if (expected && expected !== actual) {
    throw new Error(`Console vault master key fingerprint mismatch: ${actual} !== ${expected}`)
  }
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJson(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, JsonValue> = {}

    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeJson(record[key])
    }

    return normalized
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return String(value)
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeJson(value))
}

function hashPayload(value: string) {
  return `sha256_${createHash('sha256').update(value).digest('hex')}`
}

function signingFingerprint(publicKeyPem: string) {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32)
}

function verifySignature(input: {
  payload: string
  signature: string
  publicKeyPem: string
}) {
  return nodeVerify(
    null,
    Buffer.from(input.payload),
    createPublicKey(input.publicKeyPem),
    Buffer.from(input.signature, 'base64url')
  )
}

function parseJsonObject<T>(raw: string, label: string): T {
  try {
    const parsed = JSON.parse(raw) as T
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} is not an object`)
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} parse failed: ${message}`)
  }
}

async function readLicenseToken(config: PlatformRuntimeConfig) {
  const inlineToken = normalizeString(config.licenseToken) || runtimeEnvValue('HZY_PLATFORM_LICENSE_TOKEN', 'PLATFORM_LICENSE_TOKEN')
  if (inlineToken) {
    return inlineToken
  }

  if (!config.licensePath) {
    throw new Error('Console license token is not configured; set HZY_PLATFORM_LICENSE_TOKEN or HZY_PLATFORM_LICENSE_PATH')
  }

  const { readFile } = await import('node:fs/promises')
  return readFile(resolvePath(config.licensePath), 'utf8')
}

export function loadPlatformRuntimeConfig(event?: H3Event): PlatformRuntimeConfig {
  const runtimeEvent = (event as (H3Event & CloudflareRuntimeEvent) | undefined) || getRuntimeEvent()
  const config = useRuntimeConfig(event)
  const platform = getRecord(config.platform) || {}
  const runtimeMode = loadConsoleRuntimeMode(event)
  const vaultConfig = getRecord(config.vault) || {}
  const managedTenant = runtimeMode.activationMode === 'managed-cloud-multitenant'
    ? resolveManagedCloudTenantContext(runtimeEvent)
    : null

  if (!runtimeMode.runtimeEnabled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Console platform runtime disabled',
      message: `console platform runtime is disabled for run mode ${runtimeMode.runMode}`
    })
  }

  const values = {
    baseUrl: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_URL', 'PLATFORM_BASE_URL') || normalizeString(platform.baseUrl),
    tenantCode: managedTenant?.tenantCode || tenantGatewayHeader(runtimeEvent, 'x-hzy-tenant') || runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_TENANT_CODE', 'TENANT_CODE') || normalizeString(platform.tenantCode),
    deploymentCode: managedTenant?.deploymentCode || tenantGatewayHeader(runtimeEvent, 'x-hzy-deployment') || runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE') || normalizeString(platform.deploymentCode),
    environment: managedTenant?.environment || normalizeEnvironment(runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_ENVIRONMENT', 'HZY_DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_ENVIRONMENT') || platform.environment || 'prod'),
    runtimeToken: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_RUNTIME_TOKEN', 'RUNTIME_TOKEN', 'PLATFORM_RUNTIME_TOKEN') || normalizeString(platform.runtimeToken),
    platformServiceToken: runtimeEnvValueForEvent(runtimeEvent, 'HZY_CLOUDFLARE_INTERNAL_TOKEN', 'HZY_CONSOLE_PLATFORM_SERVICE_TOKEN', 'HZY_PLATFORM_INTERNAL_SERVICE_TOKEN', 'PLATFORM_INTERNAL_SERVICE_TOKEN') || normalizeString(platform.platformServiceToken),
    signingKid: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_SIGNING_KID', 'PLATFORM_SIGNING_KID') || normalizeString(platform.signingKid),
    signingPubkey: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_SIGNING_PUBKEY', 'PLATFORM_SIGNING_PUBKEY') || normalizeString(platform.signingPubkey),
    licenseToken: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_LICENSE_TOKEN', 'PLATFORM_LICENSE_TOKEN') || normalizeString(platform.licenseToken),
    licensePath: runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_LICENSE_PATH', 'PLATFORM_LICENSE_PATH') || normalizeString(platform.licensePath),
    bundleCacheDir: resolvePlatformBundleCacheDir(event),
    vaultMasterKey: runtimeEnvValueForEvent(runtimeEvent, 'HZY_CONSOLE_VAULT_MASTER_KEY', 'CONSOLE_VAULT_MASTER_KEY') || normalizeString(vaultConfig.masterKey),
    heartbeatIntervalMs: Math.max(30000, Number(runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_HEARTBEAT_INTERVAL_MS', 'PLATFORM_HEARTBEAT_INTERVAL_MS') || platform.heartbeatIntervalMs || 300000))
  }
  const missing = Object.entries({
    HZY_PLATFORM_URL: values.baseUrl,
    HZY_PLATFORM_SIGNING_KID: values.signingKid,
    HZY_PLATFORM_SIGNING_PUBKEY: values.signingPubkey
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (runtimeMode.activationMode === 'managed-cloud-multitenant') {
    if (!values.platformServiceToken) {
      missing.push('HZY_CLOUDFLARE_INTERNAL_TOKEN or HZY_CONSOLE_PLATFORM_SERVICE_TOKEN')
    }
    if (!tenantGatewayToken(runtimeEvent)) {
      missing.push('HZY_CLOUDFLARE_INTERNAL_TOKEN or HZY_TENANT_GATEWAY_INTERNAL_TOKEN')
    }
  } else {
    for (const [key, item] of Object.entries({
      HZY_PLATFORM_TENANT_CODE: values.tenantCode,
      HZY_PLATFORM_DEPLOYMENT_CODE: values.deploymentCode,
      HZY_PLATFORM_RUNTIME_TOKEN: values.runtimeToken
    })) {
      if (!item) missing.push(key)
    }
    if (!values.licenseToken && !values.licensePath && !runtimeEnvValueForEvent(runtimeEvent, 'HZY_PLATFORM_LICENSE_TOKEN', 'PLATFORM_LICENSE_TOKEN')) {
      missing.push('HZY_PLATFORM_LICENSE_TOKEN or HZY_PLATFORM_LICENSE_PATH')
    }
  }

  if (missing.length) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Console activation env missing',
      message: `console activation env missing: ${missing.join(', ')}`
    })
  }

  return {
    ...values,
    ...runtimeMode,
    baseUrl: normalizeBaseUrl(values.baseUrl),
    signingPubkey: normalizePem(values.signingPubkey)
  }
}

export async function readAndVerifyLicense(config: PlatformRuntimeConfig): Promise<VerifiedLicense> {
  const token = parseJsonObject<LicenseToken>(
    await readLicenseToken(config),
    config.licenseToken ? 'HZY_PLATFORM_LICENSE_TOKEN' : 'HZY_PLATFORM_LICENSE_PATH'
  )

  if (token.schemaVersion !== 'license-token.v1') {
    throw new Error(`unsupported license token schema: ${token.schemaVersion}`)
  }

  if (token.alg !== 'Ed25519') {
    throw new Error(`unsupported license alg: ${token.alg}`)
  }

  if (token.kid !== config.signingKid) {
    throw new Error(`license kid mismatch: ${token.kid} !== ${config.signingKid}`)
  }

  const payload = token.payload || {}
  const tenantCode = normalizeString(payload.tenantCode)
  const deploymentCode = normalizeString(payload.deploymentCode)
  const appCode = normalizeString(payload.appCode)

  if (tenantCode !== config.tenantCode) {
    throw new Error(`license tenantCode mismatch: ${tenantCode} !== ${config.tenantCode}`)
  }

  if (deploymentCode !== config.deploymentCode) {
    throw new Error(`license deploymentCode mismatch: ${deploymentCode} !== ${config.deploymentCode}`)
  }

  if (appCode !== 'console') {
    throw new Error(`license appCode mismatch: ${appCode} !== console`)
  }

  const expiresAt = normalizeString(payload.expiresAt)
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error(`license expired: ${expiresAt}`)
  }

  const verified = verifySignature({
    payload: JSON.stringify(payload),
    signature: token.signature,
    publicKeyPem: config.signingPubkey
  })

  if (!verified) {
    throw new Error('license signature verification failed')
  }

  verifyLicenseVaultFingerprint(payload, config.vaultMasterKey)

  return {
    token,
    payload
  }
}

export async function fetchAndVerifyPolicyBundle(config: PlatformRuntimeConfig): Promise<CachedPolicyBundle> {
  if (!config.tenantCode) {
    throw new Error('tenant context is required to fetch policy bundle')
  }

  if (config.activationMode !== 'managed-cloud-multitenant' && !config.deploymentCode) {
    throw new Error('deploymentCode is required to fetch policy bundle')
  }

  const response = config.activationMode === 'managed-cloud-multitenant'
    ? await $fetch<PlatformBundleEnvelope>(
        `${config.baseUrl}/api/platform/internal/console/tenants/${encodeURIComponent(config.tenantCode)}/bundle`,
        {
          query: {
            environment: config.environment,
            ...(config.deploymentCode ? { deploymentCode: config.deploymentCode } : {})
          },
          headers: {
            'Authorization': `Bearer ${config.platformServiceToken}`,
            'x-hzy-internal-principal': 'console-managed-cloud-worker'
          },
          timeout: 10000
        }
      )
    : await $fetch<PlatformBundleEnvelope>(
        `${config.baseUrl}/api/v1/runtime/deployments/${encodeURIComponent(config.deploymentCode)}/bundle`,
        {
          query: {
            tenantCode: config.tenantCode
          },
          headers: {
            Authorization: `Bearer ${config.runtimeToken}`
          },
          timeout: 10000
        }
      )
  const data = response.data

  if (!isSuccessfulPlatformBundleEnvelope(response) || !data) {
    throw new Error('platform bundle response is invalid')
  }

  if (!data.signature || !data.kid || !data.alg) {
    throw new Error('platform bundle signature fields are missing')
  }

  if (data.alg !== 'Ed25519') {
    throw new Error(`unsupported bundle alg: ${data.alg}`)
  }

  const signingKey = await resolvePlatformBundleSigningKey(config, data.kid)
  if (signingKey.alg !== data.alg) {
    throw new Error(`bundle signing key alg mismatch: ${signingKey.alg} !== ${data.alg}`)
  }

  if (normalizeString(data.tenantCode) !== config.tenantCode) {
    throw new Error(`bundle tenant mismatch: ${data.tenantCode} !== ${config.tenantCode}`)
  }

  if (config.deploymentCode && normalizeString(data.deploymentId) !== config.deploymentCode) {
    throw new Error(`bundle deployment mismatch: ${data.deploymentId} !== ${config.deploymentCode}`)
  }

  const payloadJson = stableStringify(data.bundle)
  const bundleHash = hashPayload(payloadJson)
  if (bundleHash !== data.bundleHash) {
    throw new Error(`bundle hash mismatch: ${bundleHash} !== ${data.bundleHash}`)
  }

  const verified = verifySignature({
    payload: payloadJson,
    signature: data.signature,
    publicKeyPem: signingKey.publicKey
  })

  if (!verified) {
    throw new Error('bundle signature verification failed')
  }

  return {
    tenantCode: data.tenantCode,
    deploymentCode: data.deploymentId,
    bundleVersion: data.bundleVersion,
    bundleHash: data.bundleHash,
    schemaVersion: data.schemaVersion,
    status: data.status,
    generatedAt: data.generatedAt,
    expiresAt: data.expiresAt,
    signature: data.signature,
    kid: data.kid,
    alg: data.alg,
    signedAt: data.signedAt,
    payload: data.bundle,
    cachedAt: new Date().toISOString()
  }
}

export async function postPlatformHeartbeat(config: PlatformRuntimeConfig, bundle: CachedPolicyBundle | null) {
  const authRuntime = await collectAuthRuntimeHealthSummary().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    return {
      signingKid: null,
      activeClients: 0,
      activeSessions: 0,
      lastAuthError: message,
      lastAuthErrorAt: new Date().toISOString()
    }
  })

  return $fetch<HeartbeatEnvelope>(
    `${config.baseUrl}/api/v1/runtime/heartbeat`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.runtimeToken}`
      },
      body: {
        deploymentId: config.deploymentCode,
        tenantCode: config.tenantCode,
        runtimeId: config.deploymentCode,
        appCode: 'console',
        appVersion: process.env.npm_package_version || '0.0.0-dev',
        sdkVersion: 'console-bootstrap.v1',
        bundleVersion: bundle?.bundleVersion || null,
        licenseStatusSeen: 'active',
        heartbeatAt: new Date().toISOString(),
        signingKey: {
          kid: config.signingKid,
          fingerprint: signingFingerprint(config.signingPubkey)
        },
        payload: {
          activationMode: bundle ? 'active' : 'pending',
          bundleReady: Boolean(bundle),
          authRuntime
        }
      },
      timeout: 5000
    }
  )
}

export async function fetchPlatformTenantProfile(config: PlatformRuntimeConfig): Promise<PlatformTenantProfileResponse> {
  const response = await $fetch<PlatformTenantProfileEnvelope>(
    `${config.baseUrl}/api/v1/runtime/tenants/${encodeURIComponent(config.tenantCode)}/profile`,
    {
      query: {
        tenantCode: config.tenantCode
      },
      headers: {
        Authorization: `Bearer ${config.runtimeToken}`
      },
      timeout: 10000
    }
  )

  if (response.code !== 0 || !response.data) {
    throw new Error('platform tenant profile response is invalid')
  }

  if (normalizeString(response.data.tenantCode) !== config.tenantCode) {
    throw new Error(`platform tenant profile mismatch: ${response.data.tenantCode} !== ${config.tenantCode}`)
  }

  return response.data
}

export async function refreshPlatformBundle(reason: string, event?: H3Event): Promise<RefreshBundleResult> {
  const runtimeMode = loadConsoleRuntimeMode(event)
  if (!runtimeMode.runtimeEnabled) {
    const status = runtimeDisabledActivationStatus()
    return {
      ok: true,
      status,
      bundle: null,
      authClientMaterialization: null,
      error: null
    }
  }

  const config = loadPlatformRuntimeConfig(event)
  const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
  if (config.activationMode === 'managed-cloud-multitenant' && !config.tenantCode) {
    const status = await patchActivationStatus(config.bundleCacheDir, {
      mode: 'pending',
      activated: false,
      envValid: true,
      licenseValid: true,
      bundleReady: false,
      tenantCode: null,
      deploymentCode: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: 'tenant context is required; access Console through Tenant Gateway'
    }, cacheScope)
    return {
      ok: false,
      status,
      bundle: null,
      authClientMaterialization: null,
      error: status.lastError
    }
  }

  try {
    if (config.activationMode !== 'managed-cloud-multitenant') {
      await readAndVerifyLicense(config)
    }
    const bundle = await fetchAndVerifyPolicyBundle(config)
    const effectiveCacheScope = resolvePlatformRuntimeCacheScope({
      ...config,
      tenantCode: bundle.tenantCode,
      environment: config.environment
    }, event)
    await writeCachedBundle(config.bundleCacheDir, bundle, effectiveCacheScope)
    const materialized = config.authClientMaterializeEnabled
      ? await materializeAuthClientsFromBundle(bundle)
      : null
    const status = await patchActivationStatus(config.bundleCacheDir, {
      mode: 'active',
      activated: true,
      envValid: true,
      licenseValid: true,
      bundleReady: true,
      tenantCode: bundle.tenantCode,
      deploymentCode: bundle.deploymentCode,
      bundleVersion: bundle.bundleVersion,
      bundleHash: bundle.bundleHash,
      lastCheckedAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      lastError: null
    }, effectiveCacheScope)

    if (config.activationMode !== 'managed-cloud-multitenant' && config.heartbeatEnabled) {
      await postPlatformHeartbeat(config, bundle)
        .then(async () => {
          await patchActivationStatus(config.bundleCacheDir, {
            lastHeartbeatAt: new Date().toISOString()
          }, effectiveCacheScope)
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[console] platform heartbeat failed after ${reason}: ${message}`)
        })
    }

    return {
      ok: true,
      status,
      bundle,
      authClientMaterialization: materialized,
      error: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = await patchActivationStatus(config.bundleCacheDir, {
      mode: 'failed',
      activated: false,
      envValid: true,
      licenseValid: config.activationMode === 'managed-cloud-multitenant',
      bundleReady: false,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    }, cacheScope)

    return {
      ok: false,
      status,
      bundle: null,
      authClientMaterialization: null,
      error: message
    }
  }
}

export async function loadActivationStatus(event?: H3Event) {
  const runtimeMode = loadConsoleRuntimeMode(event)
  if (!runtimeMode.runtimeEnabled) {
    return runtimeDisabledActivationStatus()
  }

  let config: PlatformRuntimeConfig

  try {
    config = loadPlatformRuntimeConfig(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...emptyActivationStatus(),
      mode: 'failed' as const,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    }
  }

  const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
  if (config.activationMode === 'managed-cloud-multitenant' && !config.tenantCode) {
    const status = await readActivationStatus(config.bundleCacheDir, cacheScope)
    return {
      ...status,
      mode: 'pending' as const,
      activated: false,
      envValid: true,
      licenseValid: true,
      bundleReady: false,
      tenantCode: null,
      deploymentCode: null,
      lastCheckedAt: status.lastCheckedAt || new Date().toISOString(),
      lastError: null
    }
  }

  const [status, bundle] = await Promise.all([
    readActivationStatus(config.bundleCacheDir, cacheScope),
    readCachedBundle(config.bundleCacheDir, cacheScope)
  ])

  if (bundle && status.activated) {
    const invalidReason = getCachedBundleInvalidReason(bundle)
    if (invalidReason) {
      return {
        ...status,
        mode: 'failed' as const,
        activated: false,
        envValid: true,
        bundleReady: false,
        tenantCode: bundle.tenantCode || config.tenantCode,
        deploymentCode: bundle.deploymentCode || config.deploymentCode,
        bundleVersion: bundle.bundleVersion,
        bundleHash: bundle.bundleHash,
        lastError: invalidReason
      }
    }

    return {
      ...status,
      mode: 'active' as const,
      activated: true,
      envValid: true,
      bundleReady: true,
      tenantCode: bundle.tenantCode || config.tenantCode,
      deploymentCode: bundle.deploymentCode || config.deploymentCode,
      bundleVersion: bundle.bundleVersion,
      bundleHash: bundle.bundleHash
    }
  }

  return {
    ...status,
    tenantCode: status.tenantCode || config.tenantCode,
    deploymentCode: status.deploymentCode || config.deploymentCode
  }
}
