import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'

const RUNTIME_TOKEN_PREFIX = 'hzy_rt_'

interface RuntimeCredentialRow extends RowDataPacket {
  tenant_code: string
  credential_mode: string
  runtime_token_hash: string
  runtime_token_last4: string
  status: string
  issued_by_account_id: number | null
  issued_at: string
  rotated_at: string | null
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
}

export type RuntimeCredentialSnapshot = {
  tenantCode: string
  credentialMode: string
  runtimeTokenLast4: string
  status: string
  issuedByAccountId: number | null
  issuedAt: string
  rotatedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
}

export function generateRuntimeToken() {
  return `${RUNTIME_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function isRuntimeToken(value: unknown) {
  return String(value || '').startsWith(RUNTIME_TOKEN_PREFIX)
}

export function hashRuntimeToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function toSnapshot(row: RuntimeCredentialRow): RuntimeCredentialSnapshot {
  return {
    tenantCode: row.tenant_code,
    credentialMode: row.credential_mode,
    runtimeTokenLast4: row.runtime_token_last4,
    status: row.status,
    issuedByAccountId: row.issued_by_account_id,
    issuedAt: row.issued_at,
    rotatedAt: row.rotated_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at
  }
}

export async function issueRuntimeToken(options: {
  tenantCode: string
  issuedByAccountId?: number | null
  expiresAt?: string | null
}) {
  const token = generateRuntimeToken()
  const tokenHash = hashRuntimeToken(token)
  const tokenLast4 = token.slice(-4)

  await execute<ResultSetHeader>(
    `INSERT INTO tenant_runtime_credentials
      (tenant_code, credential_mode, runtime_token_hash, runtime_token_last4, status,
       issued_by_account_id, issued_at, rotated_at, expires_at, revoked_at, last_used_at, created_at, updated_at)
     VALUES (?, 'tenant', ?, ?, 'active', ?, UTC_TIMESTAMP(), NULL, ?, NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       credential_mode = 'tenant',
       runtime_token_hash = VALUES(runtime_token_hash),
       runtime_token_last4 = VALUES(runtime_token_last4),
       status = 'active',
       issued_by_account_id = VALUES(issued_by_account_id),
       issued_at = UTC_TIMESTAMP(),
       rotated_at = UTC_TIMESTAMP(),
       expires_at = VALUES(expires_at),
       revoked_at = NULL,
       last_used_at = NULL,
       updated_at = UTC_TIMESTAMP()`,
    [options.tenantCode, tokenHash, tokenLast4, options.issuedByAccountId || null, options.expiresAt || null]
  )

  const credential = await findRuntimeCredential(options.tenantCode)
  if (!credential) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load issued runtime credential'
    })
  }

  return {
    token,
    tokenHash,
    tokenLast4,
    credential
  }
}

export async function findRuntimeCredential(tenantCode: string) {
  const row = await queryRow<RuntimeCredentialRow>(
    `SELECT tenant_code, credential_mode, runtime_token_hash, runtime_token_last4, status,
            issued_by_account_id, issued_at, rotated_at, expires_at, revoked_at, last_used_at
     FROM tenant_runtime_credentials
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )

  return row ? toSnapshot(row) : null
}

export async function verifyRuntimeToken(options: {
  tenantCode: string
  token: string
  touchLastUsedAt?: boolean
}) {
  if (!isRuntimeToken(options.token)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'invalid runtime token'
    })
  }

  const row = await queryRow<RuntimeCredentialRow>(
    `SELECT tenant_code, credential_mode, runtime_token_hash, runtime_token_last4, status,
            issued_by_account_id, issued_at, rotated_at, expires_at, revoked_at, last_used_at
     FROM tenant_runtime_credentials
     WHERE tenant_code = ?
       AND status = 'active'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
     LIMIT 1`,
    [options.tenantCode]
  )

  const tokenHash = hashRuntimeToken(options.token)
  if (!row || !safeHashEquals(row.runtime_token_hash, tokenHash)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'invalid runtime token'
    })
  }

  if (options.touchLastUsedAt !== false) {
    await execute<ResultSetHeader>(
      `UPDATE tenant_runtime_credentials
       SET last_used_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?`,
      [options.tenantCode]
    )
  }

  return toSnapshot(row)
}

export async function revokeRuntimeToken(tenantCode: string) {
  const result = await execute<ResultSetHeader>(
    `UPDATE tenant_runtime_credentials
     SET status = 'revoked',
         revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
         updated_at = UTC_TIMESTAMP()
     WHERE tenant_code = ?`,
    [tenantCode]
  )

  return result.affectedRows
}
