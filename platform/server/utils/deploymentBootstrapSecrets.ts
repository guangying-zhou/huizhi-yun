import { createHash, randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'

export const CONSOLE_VAULT_MASTER_KEY_SECRET_CODE = 'console.vault.master_key'

interface DeploymentBootstrapSecretRow extends RowDataPacket {
  id: number
  secret_value: string
  status: string
}

type BootstrapSecretExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

function generateVaultMasterKey() {
  return randomBytes(32).toString('base64')
}

export function normalizeConsoleVaultMasterKey(value: string) {
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

export function fingerprintConsoleVaultMasterKey(value: string) {
  return `sha256:${createHash('sha256').update(normalizeConsoleVaultMasterKey(value)).digest('hex').slice(0, 32)}`
}

function secretLast4(value: string) {
  return value.slice(-4)
}

function getExecutor(executor?: BootstrapSecretExecutor): BootstrapSecretExecutor {
  return executor || { queryRow, execute }
}

async function loadDeploymentBootstrapSecret(deploymentId: number, secretCode: string, executor?: BootstrapSecretExecutor) {
  const db = getExecutor(executor)
  return await db.queryRow<DeploymentBootstrapSecretRow>(
    `SELECT id, secret_value, status
     FROM deployment_bootstrap_secrets
     WHERE deployment_id = ?
       AND secret_code = ?
       AND status = 'active'
     LIMIT 1`,
    [deploymentId, secretCode]
  )
}

async function loadDeploymentBootstrapSecretAnyStatus(deploymentId: number, secretCode: string, executor?: BootstrapSecretExecutor) {
  const db = getExecutor(executor)
  return await db.queryRow<DeploymentBootstrapSecretRow>(
    `SELECT id, secret_value, status
     FROM deployment_bootstrap_secrets
     WHERE deployment_id = ?
       AND secret_code = ?
     LIMIT 1`,
    [deploymentId, secretCode]
  )
}

async function loadDeploymentBootstrapSecretById(secretId: number, executor?: BootstrapSecretExecutor) {
  return await getExecutor(executor).queryRow<DeploymentBootstrapSecretRow>(
    `SELECT id, secret_value, status
     FROM deployment_bootstrap_secrets
     WHERE id = ?
       AND secret_code = ?
     LIMIT 1`,
    [secretId, CONSOLE_VAULT_MASTER_KEY_SECRET_CODE]
  )
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_DUP_ENTRY'
}

function isMissingTableError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE'
}

function missingTableError() {
  return createError({
    statusCode: 500,
    statusMessage: 'Internal Server Error',
    message: 'deployment_bootstrap_secrets table is missing; apply platform/docs/sql/HZY-Platform-SQL-Migration-v2.10-console-vault-master-key.sql first'
  })
}

export async function ensureConsoleVaultMasterKey(input: {
  deploymentId: number
  tenantCode: string
  appCode: string
  executor?: BootstrapSecretExecutor
}) {
  let existing: DeploymentBootstrapSecretRow | null = null
  try {
    existing = await loadDeploymentBootstrapSecret(input.deploymentId, CONSOLE_VAULT_MASTER_KEY_SECRET_CODE, input.executor)
  } catch (error) {
    if (isMissingTableError(error)) {
      throw missingTableError()
    }
    throw error
  }

  if (existing?.secret_value) {
    return existing.secret_value
  }

  const retired = await loadDeploymentBootstrapSecretAnyStatus(
    input.deploymentId,
    CONSOLE_VAULT_MASTER_KEY_SECRET_CODE,
    input.executor
  )
  if (retired?.status === 'migrated') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'Console Vault master key is customer-held by Tenant Runtime and cannot be reissued by Platform'
    })
  }

  const secretValue = generateVaultMasterKey()

  try {
    await getExecutor(input.executor).execute<ResultSetHeader>(
      `INSERT INTO deployment_bootstrap_secrets
        (deployment_id, tenant_code, app_code, secret_code, secret_name, secret_value, secret_last4, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Console vault master key', ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        input.deploymentId,
        input.tenantCode,
        input.appCode,
        CONSOLE_VAULT_MASTER_KEY_SECRET_CODE,
        secretValue,
        secretLast4(secretValue)
      ]
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      throw missingTableError()
    }
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    const raced = await loadDeploymentBootstrapSecret(input.deploymentId, CONSOLE_VAULT_MASTER_KEY_SECRET_CODE, input.executor)
    if (raced?.secret_value) {
      return raced.secret_value
    }
    throw error
  }

  return secretValue
}

export async function loadConsoleVaultMasterKeyForMigration(deploymentId: number, executor?: BootstrapSecretExecutor) {
  const secret = await loadDeploymentBootstrapSecret(
    deploymentId,
    CONSOLE_VAULT_MASTER_KEY_SECRET_CODE,
    executor
  )
  if (!secret?.secret_value) {
    const retired = await loadDeploymentBootstrapSecretAnyStatus(
      deploymentId,
      CONSOLE_VAULT_MASTER_KEY_SECRET_CODE,
      executor
    )
    if (retired?.status === 'migrated') {
      return {
        status: 'migrated' as const,
        secretId: retired.id,
        fingerprint: retired.secret_value
      }
    }
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'active Console Vault bootstrap secret is not available for migration'
    })
  }
  return {
    status: 'active' as const,
    secretId: secret.id,
    value: secret.secret_value,
    fingerprint: fingerprintConsoleVaultMasterKey(secret.secret_value)
  }
}

export async function retireConsoleVaultMasterKeyAfterMigration(input: {
  secretId: number
  expectedValue: string
  fingerprint: string
  executor?: BootstrapSecretExecutor
}) {
  const result = await getExecutor(input.executor).execute<ResultSetHeader>(
    `UPDATE deployment_bootstrap_secrets
     SET secret_value = ?,
         secret_last4 = NULL,
         status = 'migrated',
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?
       AND secret_code = ?
       AND status = 'active'
       AND secret_value = ?`,
    [
      input.fingerprint,
      input.secretId,
      CONSOLE_VAULT_MASTER_KEY_SECRET_CODE,
      input.expectedValue
    ]
  )
  if (result.affectedRows === 1) {
    return
  }
  const current = await loadDeploymentBootstrapSecretById(input.secretId, input.executor)
  if (current?.status === 'migrated' && current.secret_value === input.fingerprint) {
    return
  }
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    message: 'Console Vault bootstrap secret changed while migration was in progress'
  })
}
