import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createError, getHeader, getRequestIP, type H3Event } from 'h3'
import { importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { getOidcIssuer, getPublishedJwks, hashOpaqueValue } from '~~/server/utils/oidc'

type VaultStorageBackend = 'db_encrypted' | 'env_ref' | 'docker_secret' | 'k8s_secret'
type VaultUsageType = 'integration' | 'service' | 'bootstrap' | 'custody'
type VaultAction = 'resolve' | 'reveal' | 'rotate' | 'validate'

interface SecretListRow extends RowDataPacket {
  id: number
  secretCode: string
  secretRef: string
  secretName: string
  secretType: string
  usageType: VaultUsageType
  ownerType: string
  ownerKey: string | null
  storageBackend: VaultStorageBackend
  revealPolicy: string
  maskedPreview: string | null
  expiresAt: string | null
  lastRotatedAt: string | null
  status: string
  currentVersionNo: number | null
  createdAt: string
  updatedAt: string
}

interface SecretCurrentRow extends RowDataPacket {
  id: number
  secretCode: string
  secretRef: string
  secretName: string
  secretType: string
  usageType: VaultUsageType
  ownerType: string
  ownerKey: string | null
  storageBackend: VaultStorageBackend
  kmsKeyRef: string | null
  revealPolicy: string
  maskedPreview: string | null
  status: string
  currentVersionId: number | null
  versionId: number | null
  versionNo: number | null
  ciphertextBlob: Buffer | string | null
  backendSecretRef: string | null
  contentHash: string | null
  encryptionScheme: string | null
}

interface VersionNoRow extends RowDataPacket {
  versionNo: number
}

interface ServiceTokenClaims extends JWTPayload {
  scope?: string
  token_use?: string
  client_id?: string
  hzy?: {
    clientCode?: string
    clientName?: string
    clientType?: string
    appCode?: string | null
    credentialId?: number
  }
}

type CloudflareRuntimeEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
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

export interface VaultActor {
  actorType: 'human' | 'service' | 'system'
  actorId: string | null
  appCode?: string | null
}

export interface CreateVaultSecretInput {
  secretCode?: unknown
  secretName?: unknown
  secretType?: unknown
  usageType?: unknown
  ownerType?: unknown
  ownerKey?: unknown
  storageBackend?: unknown
  material?: {
    plaintext?: unknown
    backendSecretRef?: unknown
  } | null
  revealPolicy?: unknown
  expiresAt?: unknown
  createdBy?: unknown
}

export interface CreateVaultVersionInput {
  secretCode: string
  storageBackend?: unknown
  material?: {
    plaintext?: unknown
    backendSecretRef?: unknown
  } | null
  createdBy?: unknown
  setCurrent?: boolean
  action?: VaultAction
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event?: H3Event): CloudflareRuntimeEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent | undefined
  return runtimeEvent?.context?.cloudflare?.env
    || runtimeEvent?.context?._platform?.cloudflare?.env
    || runtimeEvent?.context?.nitro?.env
    || runtimeEvent?.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function runtimeEnvValue(event: H3Event | undefined, names: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const name of names) {
    const value = stringValue(cloudflareEnv[name] || process.env[name])
    if (value) return value
  }
  return ''
}

function nullableString(value: unknown) {
  const valueString = stringValue(value)
  return valueString || null
}

function jsonParse<T>(value: Buffer | string): T {
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  return JSON.parse(raw) as T
}

function assertCode(value: unknown, field: string) {
  const normalized = stringValue(value)
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,126}[a-zA-Z0-9]$/.test(normalized)) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function assertStorageBackend(value: unknown): VaultStorageBackend {
  const normalized = stringValue(value || 'db_encrypted')
  if (!['db_encrypted', 'env_ref', 'docker_secret', 'k8s_secret'].includes(normalized)) {
    throw createError({ statusCode: 400, message: 'storageBackend is invalid' })
  }
  return normalized as VaultStorageBackend
}

function assertUsageType(value: unknown): VaultUsageType {
  const normalized = stringValue(value || 'integration')
  if (!['integration', 'service', 'bootstrap', 'custody'].includes(normalized)) {
    throw createError({ statusCode: 400, message: 'usageType is invalid' })
  }
  return normalized as VaultUsageType
}

function maskSecret(value: string) {
  if (!value) return null
  if (value.length <= 8) return '********'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function keyFingerprint(key: Buffer) {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

function getMasterKey(event?: H3Event) {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const configured = runtimeEnvValue(event, ['HZY_CONSOLE_VAULT_MASTER_KEY', 'CONSOLE_VAULT_MASTER_KEY'])
    || stringValue(config.vault?.masterKey)
  if (!configured) {
    throw createError({ statusCode: 500, message: 'Console vault master key is not configured' })
  }

  const candidates = [
    Buffer.from(configured, 'base64'),
    Buffer.from(configured, 'hex')
  ].filter(buffer => buffer.length >= 32)

  if (candidates[0]) {
    return candidates[0].subarray(0, 32)
  }

  return createHash('sha256').update(configured).digest()
}

function encryptPlaintext(plaintext: string, event?: H3Event) {
  const key = getMasterKey(event)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    blob: Buffer.from(JSON.stringify({
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
      data: ciphertext.toString('base64url')
    })),
    keyFingerprint: keyFingerprint(key)
  }
}

function decryptPlaintext(ciphertextBlob: Buffer | string, event?: H3Event) {
  const payload = jsonParse<{ v: number, alg: string, iv: string, tag: string, data: string }>(ciphertextBlob)
  if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') {
    throw createError({ statusCode: 500, message: 'Unsupported vault encryption payload' })
  }

  const key = getMasterKey(event)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}

function contentHashMatches(storedHash: string | null, value: string) {
  if (!storedHash) return true
  const expected = hashOpaqueValue(value)
  const legacyExpected = createHash('sha256').update(value).digest('hex')
  const stored = Buffer.from(storedHash)
  const actual = Buffer.from(expected)
  const legacyActual = Buffer.from(legacyExpected)
  return (stored.length === actual.length && timingSafeEqual(stored, actual))
    || (stored.length === legacyActual.length && timingSafeEqual(stored, legacyActual))
}

function parseVersionNo(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function toSqlDateTime(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw createError({ statusCode: 400, message: 'expiresAt is invalid' })
  }
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function parseSecretLookup(secretCodeOrRef: string, versionNo?: number | string | null) {
  const value = stringValue(secretCodeOrRef)
  const versionMatch = value.match(/@v(\d+)$/)
  const parsedVersionNo = versionMatch?.[1] ? Number(versionMatch[1]) : null
  const baseValue = versionMatch ? value.slice(0, versionMatch.index) : value
  const vaultPrefix = 'hzybase://vault/'
  const codeFromRef = baseValue.startsWith(vaultPrefix) ? baseValue.slice(vaultPrefix.length) : null
  const explicitVersionNo = parseVersionNo(versionNo)
  return {
    value: baseValue,
    byRef: baseValue.startsWith('hzybase://'),
    codeFromRef,
    versionNo: explicitVersionNo
      ? explicitVersionNo
      : parsedVersionNo && Number.isFinite(parsedVersionNo)
        ? parsedVersionNo
        : null
  }
}

async function readSecretFile(path: string) {
  const value = await readFile(path, 'utf8')
  return value.trimEnd()
}

async function resolveBackendSecret(storageBackend: VaultStorageBackend, backendSecretRef: string | null) {
  const ref = stringValue(backendSecretRef)
  if (!ref) {
    throw createError({ statusCode: 409, message: 'Secret backend ref is empty' })
  }

  if (storageBackend === 'env_ref') {
    const value = stringValue(process.env[ref])
    if (!value) {
      throw createError({ statusCode: 409, message: `Environment secret ${ref} is not set` })
    }
    return value
  }

  if (ref.startsWith('file://')) {
    return await readSecretFile(fileURLToPath(ref))
  }

  if (isAbsolute(ref)) {
    return await readSecretFile(ref)
  }

  if (storageBackend === 'docker_secret') {
    return await readSecretFile(join('/run/secrets', ref))
  }

  throw createError({ statusCode: 409, message: `${storageBackend} secret requires an absolute file path or file:// ref in v1` })
}

function materialPreview(storageBackend: VaultStorageBackend, plaintext: string | null, backendSecretRef: string | null) {
  if (plaintext) return maskSecret(plaintext)
  if (backendSecretRef) return `${storageBackend}:${maskSecret(backendSecretRef)}`
  return null
}

function assertEnvSecretRef(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw createError({
      statusCode: 400,
      message: 'env_ref material.backendSecretRef must be an environment variable name. Use db_encrypted when entering plaintext secret material.'
    })
  }
}

function normalizeMaterial(input: {
  storageBackend: VaultStorageBackend
  material?: { plaintext?: unknown, backendSecretRef?: unknown } | null
  event?: H3Event
}) {
  const plaintext = stringValue(input.material?.plaintext)
  const backendSecretRef = nullableString(input.material?.backendSecretRef)

  if (input.storageBackend === 'db_encrypted') {
    if (!plaintext) {
      throw createError({ statusCode: 400, message: 'material.plaintext is required for db_encrypted' })
    }
    const encrypted = encryptPlaintext(plaintext, input.event)
    return {
      ciphertextBlob: encrypted.blob,
      backendSecretRef: null,
      contentHash: hashOpaqueValue(plaintext),
      encryptionScheme: 'aes256-gcm',
      keyFingerprint: encrypted.keyFingerprint,
      maskedPreview: materialPreview(input.storageBackend, plaintext, null)
    }
  }

  if (!backendSecretRef) {
    throw createError({ statusCode: 400, message: 'material.backendSecretRef is required for external secret backends' })
  }
  if (input.storageBackend === 'env_ref') {
    assertEnvSecretRef(backendSecretRef)
  }

  return {
    ciphertextBlob: null,
    backendSecretRef,
    contentHash: plaintext ? hashOpaqueValue(plaintext) : hashOpaqueValue(backendSecretRef),
    encryptionScheme: 'external_ref',
    keyFingerprint: null,
    maskedPreview: materialPreview(input.storageBackend, null, backendSecretRef)
  }
}

function mapSecret(row: SecretListRow) {
  return {
    secretCode: row.secretCode,
    secretRef: row.secretRef,
    secretName: row.secretName,
    secretType: row.secretType,
    usageType: row.usageType,
    ownerType: row.ownerType,
    ownerKey: row.ownerKey,
    storageBackend: row.storageBackend,
    revealPolicy: row.revealPolicy,
    maskedPreview: row.maskedPreview,
    currentVersionNo: row.currentVersionNo,
    expiresAt: row.expiresAt,
    lastRotatedAt: row.lastRotatedAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function mapCurrentSecret(row: SecretCurrentRow) {
  return {
    secretCode: row.secretCode,
    secretRef: row.secretRef,
    secretName: row.secretName,
    secretType: row.secretType,
    usageType: row.usageType,
    ownerType: row.ownerType,
    ownerKey: row.ownerKey,
    storageBackend: row.storageBackend,
    revealPolicy: row.revealPolicy,
    maskedPreview: row.maskedPreview,
    currentVersionNo: row.versionNo,
    status: row.status
  }
}

export function getVaultRequestIp(event: H3Event) {
  return getRequestIP(event, { xForwardedFor: true }) || stringValue(getHeader(event, 'x-real-ip')) || null
}

export function getVaultUserAgent(event: H3Event) {
  return nullableString(getHeader(event, 'user-agent'))
}

export async function writeVaultAccessLog(input: {
  event?: H3Event
  secretId: number
  versionId?: number | null
  action: VaultAction
  actor: VaultActor
  reason?: string | null
  approvalCode?: string | null
  resultStatus?: 'success' | 'failed' | 'denied'
}) {
  await execute<ResultSetHeader>(
    `INSERT INTO vault_access_logs (
       secret_id,
       version_id,
       action,
       actor_type,
       actor_id,
       app_code,
       reason,
       approval_code,
       request_ip,
       user_agent,
       result_status,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      input.secretId,
      input.versionId || null,
      input.action,
      input.actor.actorType,
      input.actor.actorId,
      input.actor.appCode || null,
      input.reason || null,
      input.approvalCode || null,
      input.event ? getVaultRequestIp(input.event) : null,
      input.event ? getVaultUserAgent(input.event) : null,
      input.resultStatus || 'success'
    ]
  )
}

export async function listVaultSecrets(query: Record<string, unknown>) {
  const conditions: string[] = []
  const params: unknown[] = []
  const usageType = stringValue(query.usageType || query.usage_type)
  const status = stringValue(query.status)
  const search = stringValue(query.search || query.keyword)

  if (usageType) {
    assertUsageType(usageType)
    conditions.push('vs.usage_type = ?')
    params.push(usageType)
  }
  if (status) {
    conditions.push('vs.status = ?')
    params.push(status)
  }
  if (search) {
    conditions.push('(vs.secret_code LIKE ? OR vs.secret_name LIKE ? OR vs.owner_key LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const rows = await queryRows<SecretListRow[]>(
    `SELECT vs.id,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.secret_name AS secretName,
            vs.secret_type AS secretType,
            vs.usage_type AS usageType,
            vs.owner_type AS ownerType,
            vs.owner_key AS ownerKey,
            vs.storage_backend AS storageBackend,
            vs.reveal_policy AS revealPolicy,
            vs.masked_preview AS maskedPreview,
            vs.expires_at AS expiresAt,
            vs.last_rotated_at AS lastRotatedAt,
            vs.status,
            vsv.version_no AS currentVersionNo,
            vs.created_at AS createdAt,
            vs.updated_at AS updatedAt
       FROM vault_secrets vs
       LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY vs.updated_at DESC, vs.id DESC
      LIMIT 200`,
    params
  )

  return { items: rows.map(mapSecret) }
}

async function loadCurrentSecret(secretCodeOrRef: string, versionNo?: number | string | null) {
  const lookup = parseSecretLookup(secretCodeOrRef, versionNo)
  const value = lookup.value
  if (!value) {
    throw createError({ statusCode: 400, message: 'secretCode or secretRef is required' })
  }

  const versionFilter = lookup.versionNo
    ? 'AND vsv.version_no = ?'
    : ''
  const lookupCondition = lookup.byRef
    ? lookup.codeFromRef
      ? '(vs.secret_ref = ? OR vs.secret_code = ?)'
      : 'vs.secret_ref = ?'
    : 'vs.secret_code = ?'

  const params: unknown[] = []
  if (versionFilter) params.push(lookup.versionNo)
  params.push(value)
  if (lookup.byRef && lookup.codeFromRef) params.push(lookup.codeFromRef)

  const row = await queryRow<SecretCurrentRow>(
    `SELECT vs.id,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.secret_name AS secretName,
            vs.secret_type AS secretType,
            vs.usage_type AS usageType,
            vs.owner_type AS ownerType,
            vs.owner_key AS ownerKey,
            vs.storage_backend AS storageBackend,
            vs.kms_key_ref AS kmsKeyRef,
            vs.reveal_policy AS revealPolicy,
            vs.masked_preview AS maskedPreview,
            vs.status,
            vs.current_version_id AS currentVersionId,
            vsv.id AS versionId,
            vsv.version_no AS versionNo,
            vsv.ciphertext_blob AS ciphertextBlob,
            vsv.backend_secret_ref AS backendSecretRef,
            vsv.content_hash AS contentHash,
            vsv.encryption_scheme AS encryptionScheme
       FROM vault_secrets vs
       INNER JOIN vault_secret_versions vsv
          ON vsv.secret_id = vs.id
         ${versionFilter || 'AND vsv.id = vs.current_version_id'}
      WHERE ${lookupCondition}
        AND vs.status = 'active'
        AND vsv.status = 'active'
      LIMIT 1`,
    params
  )

  if (!row) {
    throw createError({
      statusCode: 404,
      message: `Secret not found: ${lookup.byRef ? 'secretRef' : 'secretCode'}=${value}${lookup.codeFromRef ? ` or secretCode=${lookup.codeFromRef}` : ''}${lookup.versionNo ? `@v${lookup.versionNo}` : ''}`
    })
  }
  return row
}

async function resolveSecretMaterial(row: SecretCurrentRow, event?: H3Event) {
  let value = ''
  if (row.encryptionScheme === 'aes256-gcm' || row.ciphertextBlob) {
    if (!row.ciphertextBlob) {
      throw createError({ statusCode: 409, message: 'Secret has no encrypted material' })
    }
    value = decryptPlaintext(row.ciphertextBlob, event)
  } else {
    value = await resolveBackendSecret(row.storageBackend, row.backendSecretRef)
  }

  const contentMatches = contentHashMatches(row.contentHash, value)
    || (row.backendSecretRef ? contentHashMatches(row.contentHash, row.backendSecretRef) : false)
  if (!contentMatches) {
    throw createError({ statusCode: 409, message: 'Secret content hash mismatch' })
  }
  return value
}

export async function createVaultSecret(input: CreateVaultSecretInput, event?: H3Event) {
  const secretCode = assertCode(input.secretCode, 'secretCode')
  const secretRef = `hzybase://vault/${secretCode}`
  const secretName = stringValue(input.secretName) || secretCode
  const secretType = stringValue(input.secretType || 'api_key')
  const usageType = assertUsageType(input.usageType)
  const ownerType = stringValue(input.ownerType || usageType)
  const ownerKey = nullableString(input.ownerKey)
  const storageBackend = assertStorageBackend(input.storageBackend)
  const revealPolicy = stringValue(input.revealPolicy || 'approval')
  const createdBy = stringValue(input.createdBy || 'system')
  const expiresAt = toSqlDateTime(input.expiresAt)
  const material = normalizeMaterial({ storageBackend, material: input.material, event })

  return await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket & { id: number }>(
      'SELECT id FROM vault_secrets WHERE secret_code = ? OR secret_ref = ? LIMIT 1',
      [secretCode, secretRef]
    )
    if (existing) {
      throw createError({ statusCode: 409, message: 'Secret already exists' })
    }

    const secretResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_secrets (
         secret_code,
         secret_ref,
         secret_name,
         secret_type,
         usage_type,
         owner_type,
         owner_key,
         storage_backend,
         reveal_policy,
         masked_preview,
         expires_at,
         status,
         created_by,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        secretCode,
        secretRef,
        secretName,
        secretType,
        usageType,
        ownerType,
        ownerKey,
        storageBackend,
        revealPolicy,
        material.maskedPreview,
        expiresAt,
        createdBy
      ]
    )

    const versionResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_secret_versions (
         secret_id,
         version_no,
         ciphertext_blob,
         backend_secret_ref,
         content_hash,
         encryption_scheme,
         key_fingerprint,
         status,
         activated_at,
         created_by,
         created_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())`,
      [
        secretResult.insertId,
        material.ciphertextBlob,
        material.backendSecretRef,
        material.contentHash,
        material.encryptionScheme,
        material.keyFingerprint,
        createdBy
      ]
    )

    await tx.execute<ResultSetHeader>(
      'UPDATE vault_secrets SET current_version_id = ?, last_rotated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [versionResult.insertId, secretResult.insertId]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_access_logs (
         secret_id,
         version_id,
         action,
         actor_type,
         actor_id,
         reason,
         result_status,
         created_at
       ) VALUES (?, ?, 'rotate', 'human', ?, 'create_secret', 'success', UTC_TIMESTAMP())`,
      [secretResult.insertId, versionResult.insertId, createdBy]
    )

    return {
      secretCode,
      secretRef,
      secretName,
      secretType,
      usageType,
      storageBackend,
      maskedPreview: material.maskedPreview,
      currentVersionNo: 1,
      status: 'active'
    }
  })
}

export async function addVaultSecretVersion(input: CreateVaultVersionInput, event?: H3Event) {
  const secretCode = assertCode(input.secretCode, 'secretCode')
  const createdBy = stringValue(input.createdBy || 'system')

  return await withTransaction(async (tx) => {
    const secret = await tx.queryRow<SecretCurrentRow>(
      `SELECT vs.id,
              vs.secret_code AS secretCode,
              vs.secret_ref AS secretRef,
              vs.secret_name AS secretName,
              vs.secret_type AS secretType,
              vs.usage_type AS usageType,
              vs.owner_type AS ownerType,
              vs.owner_key AS ownerKey,
              vs.storage_backend AS storageBackend,
              vs.kms_key_ref AS kmsKeyRef,
              vs.reveal_policy AS revealPolicy,
              vs.masked_preview AS maskedPreview,
              vs.status,
              vs.current_version_id AS currentVersionId,
              vsv.id AS versionId,
              vsv.version_no AS versionNo,
              vsv.ciphertext_blob AS ciphertextBlob,
              vsv.backend_secret_ref AS backendSecretRef,
              vsv.content_hash AS contentHash,
              vsv.encryption_scheme AS encryptionScheme
         FROM vault_secrets vs
         LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
        WHERE vs.secret_code = ?
        LIMIT 1`,
      [secretCode]
    )
    if (!secret) {
      throw createError({ statusCode: 404, message: 'Secret not found' })
    }

    const storageBackend = input.storageBackend ? assertStorageBackend(input.storageBackend) : secret.storageBackend
    const material = normalizeMaterial({ storageBackend, material: input.material, event })
    const version = await tx.queryRow<VersionNoRow>(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS versionNo FROM vault_secret_versions WHERE secret_id = ?',
      [secret.id]
    )
    const versionNo = Number(version?.versionNo || 1)

    const versionResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_secret_versions (
         secret_id,
         version_no,
         ciphertext_blob,
         backend_secret_ref,
         content_hash,
         encryption_scheme,
         key_fingerprint,
         rotated_from_id,
         status,
         activated_at,
         created_by,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())`,
      [
        secret.id,
        versionNo,
        material.ciphertextBlob,
        material.backendSecretRef,
        material.contentHash,
        material.encryptionScheme,
        material.keyFingerprint,
        secret.currentVersionId,
        createdBy
      ]
    )

    if (input.setCurrent) {
      await tx.execute<ResultSetHeader>(
        `UPDATE vault_secret_versions
            SET status = 'retired',
                retired_at = COALESCE(retired_at, UTC_TIMESTAMP())
          WHERE secret_id = ?
            AND id <> ?
            AND status = 'active'`,
        [secret.id, versionResult.insertId]
      )

      await tx.execute<ResultSetHeader>(
        `UPDATE vault_secrets
            SET current_version_id = ?,
                storage_backend = ?,
                masked_preview = ?,
                last_rotated_at = UTC_TIMESTAMP(),
                updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [versionResult.insertId, storageBackend, material.maskedPreview, secret.id]
      )
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_access_logs (
         secret_id,
         version_id,
         action,
         actor_type,
         actor_id,
         reason,
         result_status,
         created_at
       ) VALUES (?, ?, ?, 'human', ?, ?, 'success', UTC_TIMESTAMP())`,
      [secret.id, versionResult.insertId, input.action || 'rotate', createdBy, input.setCurrent ? 'rotate_current' : 'append_version']
    )

    return {
      secretCode: secret.secretCode,
      secretRef: secret.secretRef,
      versionNo,
      current: Boolean(input.setCurrent),
      status: 'active'
    }
  })
}

export async function revealVaultSecret(input: {
  event: H3Event
  secretCode: string
  versionNo?: number | null
  actor: VaultActor
  reason?: string | null
  approvalCode?: string | null
}) {
  const row = await loadCurrentSecret(input.secretCode, input.versionNo || null)
  try {
    const plaintext = await resolveSecretMaterial(row, input.event)
    await writeVaultAccessLog({
      event: input.event,
      secretId: row.id,
      versionId: row.versionId,
      action: 'reveal',
      actor: input.actor,
      reason: input.reason || null,
      approvalCode: input.approvalCode || null,
      resultStatus: 'success'
    })
    return {
      ...mapCurrentSecret(row),
      versionNo: row.versionNo,
      plaintext,
      revealedAt: new Date().toISOString()
    }
  } catch (error) {
    await writeVaultAccessLog({
      event: input.event,
      secretId: row.id,
      versionId: row.versionId,
      action: 'reveal',
      actor: input.actor,
      reason: input.reason || null,
      approvalCode: input.approvalCode || null,
      resultStatus: 'failed'
    }).catch(() => undefined)
    throw error
  }
}

export async function resolveVaultSecret(input: {
  event?: H3Event
  secretCode?: string | null
  secretRef?: string | null
  versionNo?: number | string | null
  actor: VaultActor
  purpose: string
}) {
  const key = stringValue(input.secretCode || input.secretRef)
  const row = await loadCurrentSecret(key, input.versionNo || null)
  if (row.usageType === 'custody') {
    await writeVaultAccessLog({
      event: input.event,
      secretId: row.id,
      versionId: row.versionId,
      action: 'resolve',
      actor: input.actor,
      reason: input.purpose,
      resultStatus: 'denied'
    }).catch(() => undefined)
    throw createError({ statusCode: 403, message: 'Custody secret cannot be resolved programmatically' })
  }

  try {
    const value = await resolveSecretMaterial(row, input.event)
    await writeVaultAccessLog({
      event: input.event,
      secretId: row.id,
      versionId: row.versionId,
      action: 'resolve',
      actor: input.actor,
      reason: input.purpose,
      resultStatus: 'success'
    })
    return {
      secretCode: row.secretCode,
      secretRef: row.secretRef,
      versionNo: row.versionNo,
      value
    }
  } catch (error) {
    await writeVaultAccessLog({
      event: input.event,
      secretId: row.id,
      versionId: row.versionId,
      action: 'resolve',
      actor: input.actor,
      reason: input.purpose,
      resultStatus: 'failed'
    }).catch(() => undefined)
    throw error
  }
}

export async function requireConsoleServiceActor(
  event: H3Event,
  audience: string,
  requiredScope: string
): Promise<VaultActor> {
  const authorization = stringValue(getHeader(event, 'authorization'))
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) {
    throw createError({ statusCode: 401, message: 'invalid_token: bearer token is required' })
  }

  const jwks = await getPublishedJwks()
  const header = JSON.parse(Buffer.from(match[1].split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: string, alg?: string }
  const jwk = header.kid ? jwks.keys.find(key => stringValue(key.kid) === header.kid) as JWK | undefined : undefined
  if (!jwk) {
    throw createError({ statusCode: 401, message: 'invalid_token: signing key not found' })
  }

  const key = await importJWK(jwk, header.alg || 'EdDSA')
  let payload: JWTPayload
  try {
    const verified = await jwtVerify(match[1], key, {
      issuer: getOidcIssuer(event),
      audience
    })
    payload = verified.payload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 401, message: `invalid_token: ${message}` })
  }

  const claims = payload as ServiceTokenClaims
  if (claims.token_use !== 'service') {
    throw createError({ statusCode: 401, message: 'invalid_token: service token required' })
  }

  const scopes = stringValue(claims.scope).split(/\s+/).filter(Boolean)
  if (!scopes.includes(requiredScope)) {
    throw createError({ statusCode: 403, message: `insufficient_scope: ${requiredScope}` })
  }

  return {
    actorType: 'service',
    actorId: stringValue(claims.hzy?.clientCode || claims.client_id || claims.sub),
    appCode: claims.hzy?.appCode || null
  }
}

export async function requireVaultServiceActor(event: H3Event, requiredScope = 'credential_vault:resolve'): Promise<VaultActor> {
  return await requireConsoleServiceActor(event, 'credential_vault', requiredScope)
}
