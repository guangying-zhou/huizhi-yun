import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'

const PLATFORM_SIGNING_ALG = 'Ed25519'
const DEFAULT_KEY_DIR = join(homedir(), '.huizhi-yun', 'platform-keys')
const PLATFORM_SIGNING_PRIVATE_KEY_ENVS = [
  'HZY_PLATFORM_SIGNING_PRIVATE_KEY',
  'PLATFORM_SIGNING_PRIVATE_KEY',
  'PLATFORM_SIGNING_PRIVATE_KEY_PEM'
]

type CloudflareRuntimeEnv = {
  [key: string]: unknown
}

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

type ConfiguredPrivateKey = {
  envName: string
  value: string
}

type PrivateKeyResolution
  = | { ok: true, value: string }
    | { ok: false, message: string }

type PrivateKeyValidation
  = | { ok: true, publicKeyPem: string }
    | { ok: false, message: string }

interface PlatformSigningKeyRow extends RowDataPacket {
  id: number
  kid: string
  alg: string
  public_key: string
  private_key_ref: string
  status: string
  activated_at: string
  rotated_at: string | null
  revoked_at: string | null
}

export type PlatformSigningKey = {
  id: number
  kid: string
  alg: string
  publicKey: string
  privateKeyRef: string
  status: string
  activatedAt: string
  rotatedAt: string | null
  revokedAt: string | null
}

function toSigningKey(row: PlatformSigningKeyRow): PlatformSigningKey {
  return {
    id: row.id,
    kid: row.kid,
    alg: row.alg,
    publicKey: row.public_key,
    privateKeyRef: row.private_key_ref,
    status: row.status,
    activatedAt: row.activated_at,
    rotatedAt: row.rotated_at,
    revokedAt: row.revoked_at
  }
}

async function findActivePlatformKey() {
  const row = await queryRow<PlatformSigningKeyRow>(
    `SELECT id, kid, alg, public_key, private_key_ref, status, activated_at, rotated_at, revoked_at
     FROM platform_signing_keys
     WHERE status = 'active'
       AND alg = ?
     ORDER BY activated_at DESC, id DESC
     LIMIT 1`,
    [PLATFORM_SIGNING_ALG]
  )

  return row ? toSigningKey(row) : null
}

export async function findPlatformSigningKeyByKid(kid: string) {
  const normalizedKid = String(kid || '').trim()
  if (!normalizedKid) {
    return null
  }

  const row = await queryRow<PlatformSigningKeyRow>(
    `SELECT id, kid, alg, public_key, private_key_ref, status, activated_at, rotated_at, revoked_at
     FROM platform_signing_keys
     WHERE kid = ?
       AND alg = ?
     LIMIT 1`,
    [normalizedKid, PLATFORM_SIGNING_ALG]
  )

  return row ? toSigningKey(row) : null
}

function getRuntimeSigningKeyDir() {
  try {
    const runtimeConfig = useRuntimeConfig()
    const keyDir = runtimeConfig.security?.platformSigningKeyDir
    return keyDir ? String(keyDir) : null
  } catch {
    return null
  }
}

function envValue(env: CloudflareRuntimeEnv | undefined, name: string) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function requestCloudflareEnvValue(name: string) {
  try {
    const event = useRequestEvent() as unknown as CloudflareRuntimeEvent | undefined
    const env = event?.context?.cloudflare?.env
      || event?.context?._platform?.cloudflare?.env
      || event?.context?.nitro?.env
      || event?.req?.runtime?.cloudflare?.env
    return envValue(env, name)
  } catch {
    return ''
  }
}

function cloudflareEnvValue(name: string) {
  return requestCloudflareEnvValue(name)
    || envValue(globalThis.__hzyCloudflareEnv as CloudflareRuntimeEnv | undefined, name)
}

function runtimeEnvValue(name: string) {
  return String(process.env[name] || '').trim() || cloudflareEnvValue(name)
}

function normalizePemInput(value: string) {
  const normalized = value.trim()
  if (!normalized) return ''

  if (normalized.startsWith('base64:')) {
    return Buffer.from(normalized.slice('base64:'.length), 'base64').toString('utf8').trim()
  }

  return normalized.replace(/\\n/g, '\n')
}

function privateKeyRefToPath(privateKeyRef: string) {
  return privateKeyRef.startsWith('file://')
    ? fileURLToPath(privateKeyRef)
    : privateKeyRef
}

function isPathLikePrivateKeyRef(value: string) {
  return value.startsWith('file://') || value.startsWith('/')
}

async function configuredPrivateKeyPem(): Promise<ConfiguredPrivateKey | null> {
  for (const envName of PLATFORM_SIGNING_PRIVATE_KEY_ENVS) {
    const value = normalizePemInput(runtimeEnvValue(envName))
    if (value) {
      if (isPathLikePrivateKeyRef(value)) {
        try {
          return {
            envName,
            value: await readFile(privateKeyRefToPath(value), 'utf8')
          }
        } catch {
          continue
        }
      }

      return { envName, value }
    }
  }

  return null
}

function publicKeyFromPrivateKeyPem(privateKeyPem: string) {
  const privateKey = createPrivateKey(privateKeyPem)
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
}

function validatePrivateKeyPem(privateKeyPem: string, source: string): PrivateKeyValidation {
  try {
    return {
      ok: true,
      publicKeyPem: publicKeyFromPrivateKeyPem(privateKeyPem)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `platform signing private key ${source} is invalid: ${message}`
    }
  }
}

function samePublicKey(left: string, right: string) {
  return left.replace(/\s+/g, '') === right.replace(/\s+/g, '')
}

function defaultEnsureOptions() {
  return {
    allowGenerateDevKey: process.env.NODE_ENV !== 'production',
    keyDir: getRuntimeSigningKeyDir()
  }
}

export async function getActivePlatformKey() {
  return ensurePlatformSigningKey(defaultEnsureOptions())
}

async function requireActivePlatformKey() {
  const key = await findActivePlatformKey()
  if (!key) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'active platform signing key is not configured'
    })
  }

  return key
}

function normalizePayload(payload: unknown) {
  if (Buffer.isBuffer(payload)) {
    return payload
  }

  if (typeof payload === 'string') {
    return Buffer.from(payload)
  }

  return Buffer.from(JSON.stringify(payload))
}

async function resolvePrivateKeyFileRef(
  activeKey: PlatformSigningKey,
  privateKeyRef: string,
  options: { allowConfiguredFallback?: boolean } = {}
): Promise<PrivateKeyResolution> {
  const keyPath = privateKeyRefToPath(privateKeyRef)

  try {
    return {
      ok: true,
      value: await readFile(keyPath, 'utf8')
    }
  } catch (error) {
    if (options.allowConfiguredFallback !== false) {
      const configured = await configuredPrivateKeyPem()
      if (configured) {
        try {
          const configuredPublicKey = publicKeyFromPrivateKeyPem(configured.value)
          if (samePublicKey(activeKey.publicKey, configuredPublicKey)) {
            return {
              ok: true,
              value: configured.value
            }
          }
        } catch {
          // Keep the original file error below; invalid env material is handled during key init.
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `platform signing private key file is unreadable: ${keyPath}; ${message}`
    }
  }
}

async function resolvePrivateKeyPem(activeKey: PlatformSigningKey): Promise<PrivateKeyResolution> {
  const privateKeyRef = activeKey.privateKeyRef
  if (privateKeyRef.startsWith('env:')) {
    const envName = privateKeyRef.slice('env:'.length)
    const envValue = normalizePemInput(runtimeEnvValue(envName))
    if (!envValue) {
      return {
        ok: false,
        message: `platform signing private key env is empty: ${envName}`
      }
    }

    return isPathLikePrivateKeyRef(envValue)
      ? resolvePrivateKeyFileRef(activeKey, envValue, { allowConfiguredFallback: false })
      : { ok: true, value: envValue }
  }

  if (privateKeyRef.startsWith('kms:')) {
    return {
      ok: false,
      message: 'KMS-backed platform signing keys are not implemented yet'
    }
  }

  return resolvePrivateKeyFileRef(activeKey, privateKeyRef)
}

async function resolveValidPrivateKeyPem(activeKey: PlatformSigningKey): Promise<PrivateKeyResolution> {
  const resolved = await resolvePrivateKeyPem(activeKey)
  if (!resolved.ok) {
    return resolved
  }

  const validation = validatePrivateKeyPem(resolved.value, `for kid=${activeKey.kid}`)
  if (!validation.ok) {
    return validation
  }

  if (!samePublicKey(activeKey.publicKey, validation.publicKeyPem)) {
    return {
      ok: false,
      message: `platform signing private key does not match active public key: kid=${activeKey.kid}`
    }
  }

  return resolved
}

async function activateConfiguredPlatformSigningKeyIfAvailable() {
  const configured = await configuredPrivateKeyPem()
  return configured ? activateConfiguredPlatformSigningKey(configured) : null
}

async function resolveActivePlatformSigningKeyForUse() {
  let key = await ensurePlatformSigningKey(defaultEnsureOptions())
  let resolved = await resolveValidPrivateKeyPem(key)

  if (!resolved.ok) {
    const repairedKey = await activateConfiguredPlatformSigningKeyIfAvailable()
    if (repairedKey) {
      key = repairedKey
      resolved = await resolveValidPrivateKeyPem(key)
    }
  }

  if (resolved.ok) {
    return {
      key,
      privateKeyPem: resolved.value
    }
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message: resolved.message
  })
}

export async function sign(payload: unknown) {
  const { key, privateKeyPem } = await resolveActivePlatformSigningKeyForUse()

  let signature: Buffer
  try {
    const privateKey = createPrivateKey(privateKeyPem)
    signature = nodeSign(null, normalizePayload(payload), privateKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `platform signing failed: ${message}`
    })
  }

  return {
    kid: key.kid,
    alg: key.alg,
    signature: signature.toString('base64url')
  }
}

export async function exportPubkey() {
  const key = await getActivePlatformKey()

  return {
    kid: key.kid,
    alg: key.alg,
    publicKey: key.publicKey,
    activatedAt: key.activatedAt
  }
}

function buildKid(publicKeyPem: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const digest = createHash('sha256').update(publicKeyPem).digest('base64url').slice(0, 12)
  return `psk_${date}_${digest}`
}

async function activatePlatformSigningKey(options: {
  kid: string
  publicKeyPem: string
  privateKeyRef: string
}) {
  await execute<ResultSetHeader>(
    `UPDATE platform_signing_keys
     SET status = 'rotated',
         rotated_at = COALESCE(rotated_at, UTC_TIMESTAMP()),
         updated_at = UTC_TIMESTAMP()
     WHERE status = 'active'
       AND kid <> ?`,
    [options.kid]
  )

  await execute<ResultSetHeader>(
    `INSERT INTO platform_signing_keys
      (kid, alg, public_key, private_key_ref, status, activated_at, rotated_at, revoked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(), NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       public_key = VALUES(public_key),
       private_key_ref = VALUES(private_key_ref),
       activated_at = CASE WHEN status <> 'active' THEN UTC_TIMESTAMP() ELSE activated_at END,
       status = 'active',
       rotated_at = NULL,
       revoked_at = NULL,
       updated_at = UTC_TIMESTAMP()`,
    [options.kid, PLATFORM_SIGNING_ALG, options.publicKeyPem, options.privateKeyRef]
  )

  return requireActivePlatformKey()
}

async function activateConfiguredPlatformSigningKey(configured: ConfiguredPrivateKey) {
  let publicKeyPem: string

  try {
    const privateKey = createPrivateKey(configured.value)
    publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `platform signing private key env is invalid: ${configured.envName}; ${message}`
    })
  }

  return activatePlatformSigningKey({
    kid: buildKid(publicKeyPem),
    publicKeyPem,
    privateKeyRef: `env:${configured.envName}`
  })
}

async function generateDevPlatformSigningKey(keyDir?: string | null) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const kid = buildKid(publicKeyPem)
  const resolvedKeyDir = keyDir || DEFAULT_KEY_DIR
  const keyPath = join(resolvedKeyDir, `${kid}.pem`)
  const privateKeyRef = pathToFileURL(keyPath).href

  await mkdir(resolvedKeyDir, { recursive: true, mode: 0o700 })
  await writeFile(keyPath, privateKeyPem, { mode: 0o600 })

  return activatePlatformSigningKey({
    kid,
    publicKeyPem,
    privateKeyRef
  })
}

export async function ensurePlatformSigningKey(options: {
  allowGenerateDevKey: boolean
  keyDir?: string | null
}) {
  const activeKey = await findActivePlatformKey()
  if (activeKey) {
    const resolved = await resolveValidPrivateKeyPem(activeKey)
    if (resolved.ok) {
      return activeKey
    }

    const configured = await configuredPrivateKeyPem()
    if (configured) {
      return activateConfiguredPlatformSigningKey(configured)
    }

    if (options.allowGenerateDevKey) {
      return generateDevPlatformSigningKey(options.keyDir)
    }

    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `${resolved.message}; configure HZY_PLATFORM_SIGNING_PRIVATE_KEY or restore the referenced private key file`
    })
  }

  const configured = await configuredPrivateKeyPem()
  if (configured) {
    return activateConfiguredPlatformSigningKey(configured)
  }

  if (!options.allowGenerateDevKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'active platform signing key is required'
    })
  }

  return generateDevPlatformSigningKey(options.keyDir)
}
