import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  emptyPlatformActivationStatus,
  patchPlatformActivationStatus,
  readCachedPlatformBundle,
  readPlatformActivationStatus,
  type PlatformActivationStatus,
  type PlatformCachedPolicyBundle,
  writeCachedPlatformBundle
} from './platformActivationCache'

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

interface PlatformBundleEnvelope {
  code: number
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

interface ConsolePlatformConfigEnvelope {
  code: number
  data: {
    platform: {
      baseUrl: string
      tenantCode: string
      deploymentCode: string
      runtimeToken: string
      signingKid: string
      signingPubkey: string
    }
  }
}

interface RuntimeConfigShape {
  platform?: Record<string, unknown>
  hzy?: Record<string, unknown>
  public?: Record<string, unknown>
}

export interface PlatformActivationConfig {
  enabled: boolean
  explicitEnabled: boolean
  strict: boolean
  appCode: string
  baseUrl: string
  tenantCode: string
  deploymentCode: string
  runtimeToken: string
  signingKid: string
  signingPubkey: string
  licenseToken: string
  licensePath: string
  bundleCacheDir: string
  heartbeatIntervalMs: number
  consoleApiUrl: string
  configSource: 'env' | 'console' | 'incomplete'
  missing: string[]
}

export interface VerifiedPlatformLicense {
  token: LicenseToken
  payload: Record<string, unknown>
}

export interface RefreshPlatformPolicyBundleResult {
  ok: boolean
  status: PlatformActivationStatus
  bundle: PlatformCachedPolicyBundle | null
  error: string | null
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, '\n')
}

function resolvePath(path: string) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

function boolFromEnv(value: unknown) {
  const normalized = normalizeString(value).toLowerCase()
  if (!normalized) return null
  return ['1', 'true', 'yes', 'on'].includes(normalized)
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

function parseLicenseToken(raw: string) {
  return parseJsonObject<LicenseToken>(raw, 'HZY_PLATFORM_LICENSE_TOKEN')
}

async function readPlatformLicenseRaw(config: Pick<PlatformActivationConfig, 'licenseToken' | 'licensePath'>) {
  if (config.licenseToken) {
    return config.licenseToken
  }

  if (!config.licensePath) {
    throw new Error('Platform license token is not configured; set HZY_PLATFORM_LICENSE_TOKEN or an explicit HZY_PLATFORM_LICENSE_PATH')
  }

  return readFile(resolvePath(config.licensePath), 'utf8')
}

export function formatPlatformActivationError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return String(error)
  }

  const record = error as {
    message?: string
    statusCode?: number
    statusMessage?: string
    data?: { message?: string, statusMessage?: string }
    response?: { _data?: { message?: string, statusMessage?: string } }
  }

  const message = record.message || String(error)
  const detail = record.data?.message
    || record.data?.statusMessage
    || record.response?._data?.message
    || record.response?._data?.statusMessage
    || record.statusMessage

  return detail && !message.includes(detail)
    ? `${message}: ${detail}`
    : message
}

function getNestedRecord(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function loadPlatformActivationConfig(): PlatformActivationConfig {
  const runtimeConfig = useRuntimeConfig() as unknown as RuntimeConfigShape
  const platform = runtimeConfig.platform || {}
  const hzy = runtimeConfig.hzy || {}
  const publicConfig = runtimeConfig.public || {}
  const hzyPlatform = getNestedRecord(hzy, 'platform') || {}
  const platformActivation = getNestedRecord(platform, 'activation') || {}

  const appCode = normalizeString(
    platform.appCode
    || hzyPlatform.appCode
    || hzy.appCode
    || publicConfig.appCode
    || process.env.HZY_APP_CODE
    || process.env.APP_CODE
    || publicConfig.appName
  )

  const values = {
    baseUrl: normalizeString(
      platform.baseUrl
      || hzyPlatform.baseUrl
      || hzy.platformBaseUrl
      || process.env.HZY_PLATFORM_URL
      || process.env.PLATFORM_BASE_URL
    ),
    tenantCode: normalizeString(
      platform.tenantCode
      || hzyPlatform.tenantCode
      || hzy.platformTenantCode
      || process.env.HZY_PLATFORM_TENANT_CODE
      || process.env.TENANT_CODE
    ),
    deploymentCode: normalizeString(
      platform.deploymentCode
      || hzyPlatform.deploymentCode
      || hzy.platformDeploymentCode
      || process.env.HZY_PLATFORM_DEPLOYMENT_CODE
      || process.env.DEPLOYMENT_CODE
    ),
    runtimeToken: normalizeString(
      platform.runtimeToken
      || hzyPlatform.runtimeToken
      || hzy.platformRuntimeToken
      || process.env.HZY_PLATFORM_RUNTIME_TOKEN
      || process.env.RUNTIME_TOKEN
      || process.env.HZY_PLATFORM_API_KEY
    ),
    signingKid: normalizeString(
      platform.signingKid
      || hzyPlatform.signingKid
      || hzy.platformSigningKid
      || process.env.HZY_PLATFORM_SIGNING_KID
      || process.env.PLATFORM_SIGNING_KID
    ),
    signingPubkey: normalizeString(
      platform.signingPubkey
      || hzyPlatform.signingPubkey
      || hzy.platformSigningPubkey
      || process.env.HZY_PLATFORM_SIGNING_PUBKEY
      || process.env.PLATFORM_SIGNING_PUBKEY
    ),
    licenseToken: normalizeString(
      platform.licenseToken
      || hzyPlatform.licenseToken
      || hzy.platformLicenseToken
      || process.env.HZY_PLATFORM_LICENSE_TOKEN
      || process.env.PLATFORM_LICENSE_TOKEN
    ),
    licensePath: normalizeString(
      platform.licensePath
      || hzyPlatform.licensePath
      || hzy.platformLicensePath
      || process.env.HZY_PLATFORM_LICENSE_PATH
      || process.env.PLATFORM_LICENSE_PATH
    ),
    bundleCacheDir: normalizeString(
      platform.bundleCacheDir
      || hzyPlatform.bundleCacheDir
      || hzy.platformBundleCacheDir
      || process.env.HZY_PLATFORM_BUNDLE_CACHE_DIR
    ) || '.data/platform-runtime',
    heartbeatIntervalMs: Math.max(30000, Number(
      platform.heartbeatIntervalMs
      || hzyPlatform.heartbeatIntervalMs
      || hzy.platformHeartbeatIntervalMs
      || process.env.HZY_PLATFORM_HEARTBEAT_INTERVAL_MS
      || 300000
    )),
    consoleApiUrl: normalizeBaseUrl(normalizeString(
      platform.consoleApiUrl
      || hzyPlatform.consoleApiUrl
      || hzy.consoleApiUrl
      || getNestedRecord(hzy, 'directory')?.consoleApiUrl
      || process.env.HZY_CONSOLE_API_URL
      || process.env.HZY_CONSOLE_URL
    ))
  }

  const missing = Object.entries({
    HZY_APP_CODE: appCode,
    HZY_PLATFORM_URL: values.baseUrl,
    HZY_PLATFORM_TENANT_CODE: values.tenantCode,
    HZY_PLATFORM_DEPLOYMENT_CODE: values.deploymentCode,
    HZY_PLATFORM_RUNTIME_TOKEN: values.runtimeToken,
    HZY_PLATFORM_SIGNING_KID: values.signingKid,
    HZY_PLATFORM_SIGNING_PUBKEY: values.signingPubkey
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (!values.licenseToken && !values.licensePath) {
    missing.push('HZY_PLATFORM_LICENSE_TOKEN or HZY_PLATFORM_LICENSE_PATH')
  }

  const explicitEnabled = boolFromEnv(
    platformActivation.enabled
    ?? platform.activationEnabled
    ?? hzyPlatform.activationEnabled
    ?? hzy.platformActivationEnabled
    ?? process.env.HZY_PLATFORM_ACTIVATION_ENABLED
  )
  const activationProvider = normalizeString(
    platformActivation.provider
    || platform.activationProvider
    || hzyPlatform.activationProvider
    || hzy.platformActivationProvider
    || process.env.HZY_PLATFORM_ACTIVATION_PROVIDER
  )

  const strict = boolFromEnv(
    platformActivation.strict
    ?? platform.activationStrict
    ?? hzyPlatform.activationStrict
    ?? hzy.platformActivationStrict
    ?? process.env.HZY_PLATFORM_ACTIVATION_STRICT
  ) ?? true

  const allConfigured = missing.length === 0
  const consoleUsesFoundation = appCode === 'console' && activationProvider === 'foundation'
  const enabled = appCode === 'console'
    ? consoleUsesFoundation && explicitEnabled === true && allConfigured
    : false

  return {
    enabled,
    explicitEnabled: explicitEnabled === true,
    strict,
    appCode,
    ...values,
    baseUrl: normalizeBaseUrl(values.baseUrl),
    signingPubkey: normalizePem(values.signingPubkey),
    configSource: missing.length === 0 ? 'env' : 'incomplete',
    missing
  }
}

function recomputeMissing(config: PlatformActivationConfig) {
  const missing = Object.entries({
    HZY_APP_CODE: config.appCode,
    HZY_PLATFORM_URL: config.baseUrl,
    HZY_PLATFORM_TENANT_CODE: config.tenantCode,
    HZY_PLATFORM_DEPLOYMENT_CODE: config.deploymentCode,
    HZY_PLATFORM_RUNTIME_TOKEN: config.runtimeToken,
    HZY_PLATFORM_SIGNING_KID: config.signingKid,
    HZY_PLATFORM_SIGNING_PUBKEY: config.signingPubkey
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (!config.licenseToken && !config.licensePath) {
    missing.push('HZY_PLATFORM_LICENSE_TOKEN or HZY_PLATFORM_LICENSE_PATH')
  }
  return missing
}

async function fetchConsolePlatformConfig(config: PlatformActivationConfig, licenseToken: LicenseToken) {
  if (!config.consoleApiUrl) {
    return null
  }

  const response = await $fetch<ConsolePlatformConfigEnvelope>(
    `${config.consoleApiUrl}/api/v1/platform-runtime/config`,
    {
      method: 'POST',
      body: {
        appCode: config.appCode || licenseToken.payload?.appCode || null,
        deploymentCode: config.deploymentCode || licenseToken.payload?.deploymentCode || null,
        licenseToken
      },
      timeout: 10000
    }
  )

  if (response.code !== 0 || !response.data?.platform) {
    throw new Error('console platform runtime config response is invalid')
  }

  return response.data.platform
}

export async function resolvePlatformActivationConfig(): Promise<PlatformActivationConfig> {
  const config = loadPlatformActivationConfig()
  if (!config.enabled) {
    return config
  }

  if (config.missing.length === 0) {
    return config
  }

  if (!config.consoleApiUrl) {
    return config
  }

  const licenseToken = parseLicenseToken(await readPlatformLicenseRaw(config))
  const payload = licenseToken.payload || {}
  const consoleConfig = await fetchConsolePlatformConfig(config, licenseToken)
  if (!consoleConfig) {
    return config
  }

  const resolved: PlatformActivationConfig = {
    ...config,
    appCode: config.appCode || normalizeString(payload.appCode),
    baseUrl: normalizeBaseUrl(config.baseUrl || consoleConfig.baseUrl),
    tenantCode: config.tenantCode || consoleConfig.tenantCode || normalizeString(payload.tenantCode),
    deploymentCode: config.deploymentCode || consoleConfig.deploymentCode || normalizeString(payload.deploymentCode),
    runtimeToken: config.runtimeToken || consoleConfig.runtimeToken,
    signingKid: config.signingKid || consoleConfig.signingKid,
    signingPubkey: normalizePem(config.signingPubkey || consoleConfig.signingPubkey),
    configSource: 'console'
  }

  resolved.missing = recomputeMissing(resolved)
  return resolved
}

export async function requirePlatformActivationConfig(): Promise<PlatformActivationConfig> {
  const config = await resolvePlatformActivationConfig()
  if (config.missing.length) {
    throw createError({
      statusCode: 500,
      statusMessage: 'PLATFORM_ACTIVATION_CONFIG_MISSING',
      message: `platform activation env missing: ${config.missing.join(', ')}`
    })
  }
  return config
}

export async function readAndVerifyPlatformLicense(config: PlatformActivationConfig): Promise<VerifiedPlatformLicense> {
  const token = parseLicenseToken(
    await readPlatformLicenseRaw(config)
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

  if (appCode !== config.appCode) {
    throw new Error(`license appCode mismatch: ${appCode} !== ${config.appCode}`)
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

  return {
    token,
    payload
  }
}

export async function fetchAndVerifyPlatformPolicyBundle(config: PlatformActivationConfig): Promise<PlatformCachedPolicyBundle> {
  const response = await $fetch<PlatformBundleEnvelope>(
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

  if (response.code !== 0 || !data) {
    throw new Error('platform bundle response is invalid')
  }

  if (!data.signature || !data.kid || !data.alg) {
    throw new Error('platform bundle signature fields are missing')
  }

  if (data.kid !== config.signingKid) {
    throw new Error(`bundle kid mismatch: ${data.kid} !== ${config.signingKid}`)
  }

  if (data.alg !== 'Ed25519') {
    throw new Error(`unsupported bundle alg: ${data.alg}`)
  }

  const payloadJson = stableStringify(data.bundle)
  const bundleHash = hashPayload(payloadJson)
  if (bundleHash !== data.bundleHash) {
    throw new Error(`bundle hash mismatch: ${bundleHash} !== ${data.bundleHash}`)
  }

  const verified = verifySignature({
    payload: payloadJson,
    signature: data.signature,
    publicKeyPem: config.signingPubkey
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

export async function postPlatformRuntimeHeartbeat(config: PlatformActivationConfig, bundle: PlatformCachedPolicyBundle | null) {
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
        appCode: config.appCode,
        appVersion: process.env.npm_package_version || '0.0.0-dev',
        sdkVersion: 'foundation-platform-activation.v1',
        bundleVersion: bundle?.bundleVersion || null,
        licenseStatusSeen: 'active',
        heartbeatAt: new Date().toISOString(),
        signingKey: {
          kid: config.signingKid,
          fingerprint: signingFingerprint(config.signingPubkey)
        },
        payload: {
          activationMode: bundle ? 'active' : 'pending',
          bundleReady: Boolean(bundle)
        }
      },
      timeout: 5000
    }
  )
}

export async function refreshPlatformPolicyBundle(reason: string): Promise<RefreshPlatformPolicyBundleResult> {
  const config = await requirePlatformActivationConfig()

  try {
    await readAndVerifyPlatformLicense(config)
    const bundle = await fetchAndVerifyPlatformPolicyBundle(config)
    await writeCachedPlatformBundle(config.bundleCacheDir, bundle)
    const status = await patchPlatformActivationStatus(config.bundleCacheDir, {
      mode: 'active',
      activated: true,
      envValid: true,
      licenseValid: true,
      bundleReady: true,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
      bundleVersion: bundle.bundleVersion,
      bundleHash: bundle.bundleHash,
      lastCheckedAt: new Date().toISOString(),
      lastActivatedAt: new Date().toISOString(),
      lastError: null
    })

    await postPlatformRuntimeHeartbeat(config, bundle)
      .then(async () => {
        await patchPlatformActivationStatus(config.bundleCacheDir, {
          lastHeartbeatAt: new Date().toISOString()
        })
      })
      .catch((error) => {
        const message = formatPlatformActivationError(error)
        console.warn(`[foundation.platform] heartbeat failed after ${reason}: ${message}`)
      })

    return {
      ok: true,
      status,
      bundle,
      error: null
    }
  } catch (error) {
    const message = formatPlatformActivationError(error)
    const status = await patchPlatformActivationStatus(config.bundleCacheDir, {
      mode: 'failed',
      activated: false,
      envValid: true,
      licenseValid: true,
      bundleReady: false,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    })

    return {
      ok: false,
      status,
      bundle: null,
      error: message
    }
  }
}

export async function loadPlatformActivationStatus() {
  const config = await resolvePlatformActivationConfig().catch(() => loadPlatformActivationConfig())

  if (!config.enabled) {
    return {
      ...emptyPlatformActivationStatus(),
      lastCheckedAt: new Date().toISOString(),
      lastError: config.missing.length
        ? `platform activation disabled or incomplete: ${config.missing.join(', ')}`
        : null
    }
  }

  if (config.missing.length) {
    return {
      ...emptyPlatformActivationStatus(),
      mode: 'failed' as const,
      envValid: false,
      tenantCode: config.tenantCode || null,
      deploymentCode: config.deploymentCode || null,
      lastCheckedAt: new Date().toISOString(),
      lastError: `platform activation env missing: ${config.missing.join(', ')}`
    }
  }

  const [status, bundle] = await Promise.all([
    readPlatformActivationStatus(config.bundleCacheDir),
    readCachedPlatformBundle(config.bundleCacheDir)
  ])

  if (bundle && status.activated) {
    return {
      ...status,
      mode: 'active' as const,
      activated: true,
      envValid: true,
      bundleReady: true,
      tenantCode: config.tenantCode,
      deploymentCode: config.deploymentCode,
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
