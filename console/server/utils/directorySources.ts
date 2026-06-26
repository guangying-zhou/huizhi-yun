import { createHash } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'

export type DirectorySourceProvider = 'ldap' | 'wecom' | 'dingtalk'

type DirectorySourceStatus = 'active' | 'inactive'
type StorageBackend = 'env_ref' | 'docker_secret' | 'k8s_secret'

interface DirectorySourceRow extends RowDataPacket {
  id: number
  integration_code: string
  integration_type: string
  integration_name: string
  provider_code: string
  base_url: string | null
  config_json: string | Record<string, unknown> | null
  connectivity_status: string
  last_checked_at: string | null
  last_error_message: string | null
  status: string
  secret_code: string | null
  secret_ref: string | null
  storage_backend: string | null
  backend_secret_ref: string | null
  credential_status: string | null
  created_at: string
  updated_at: string
}

interface IdRow extends RowDataPacket {
  id: number
}

interface SecretRow extends RowDataPacket {
  id: number
  current_version_id: number | null
}

export interface DirectorySourceCredentialInput {
  secretCode: string
  secretName?: string
  storageBackend: StorageBackend
  backendSecretRef: string
}

export interface UpsertDirectorySourceInput {
  providerCode: DirectorySourceProvider
  integrationName?: string
  baseUrl?: string | null
  config?: Record<string, unknown>
  credential?: DirectorySourceCredentialInput | null
  status?: DirectorySourceStatus
  requestedBy?: string | null
}

interface DirectorySourceRuntimeRow extends DirectorySourceRow {
  current_credential_id: number | null
}

function assertProvider(providerCode: unknown): DirectorySourceProvider {
  const provider = String(providerCode || '').trim() as DirectorySourceProvider
  if (['ldap', 'wecom', 'dingtalk'].includes(provider)) return provider
  throw createError({ statusCode: 400, message: 'Unsupported directory source provider' })
}

function normalizeStatus(status: unknown): DirectorySourceStatus {
  return String(status || 'active') === 'inactive' ? 'inactive' : 'active'
}

function integrationCode(providerCode: DirectorySourceProvider) {
  return `directory.${providerCode}`
}

function defaultIntegrationName(providerCode: DirectorySourceProvider) {
  const names: Record<DirectorySourceProvider, string> = {
    ldap: 'LDAP 目录源',
    wecom: '企业微信通讯录',
    dingtalk: '钉钉通讯录'
  }
  return names[providerCode]
}

function defaultSecretCode(providerCode: DirectorySourceProvider) {
  const codes: Record<DirectorySourceProvider, string> = {
    ldap: 'directory.ldap.bind_password',
    wecom: 'directory.wecom.contact_secret',
    dingtalk: 'directory.dingtalk.app_secret'
  }
  return codes[providerCode]
}

function maskBackendSecretRef(ref: string | null) {
  if (!ref) return null
  if (ref.length <= 8) return '********'
  return `${ref.slice(0, 4)}****${ref.slice(-4)}`
}

function hashRef(ref: string) {
  return createHash('sha256').update(ref).digest('hex')
}

function parseConfig(value: DirectorySourceRow['config_json']) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return value
}

function mapSource(row: DirectorySourceRow) {
  return {
    providerCode: row.provider_code,
    integrationCode: row.integration_code,
    integrationType: row.integration_type,
    integrationName: row.integration_name,
    baseUrl: row.base_url,
    config: parseConfig(row.config_json),
    connectivityStatus: row.connectivity_status,
    lastCheckedAt: row.last_checked_at,
    lastErrorMessage: row.last_error_message,
    status: row.status,
    credential: row.secret_code
      ? {
          secretCode: row.secret_code,
          secretRef: row.secret_ref,
          storageBackend: row.storage_backend,
          backendSecretRefMasked: maskBackendSecretRef(row.backend_secret_ref),
          status: row.credential_status
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export async function listDirectorySources() {
  const rows = await queryRows<DirectorySourceRow[]>(
    `SELECT
        i.id,
        i.integration_code,
        i.integration_type,
        i.integration_name,
        i.provider_code,
        i.base_url,
        i.config_json,
        i.connectivity_status,
        i.last_checked_at,
        i.last_error_message,
        i.status,
        vs.secret_code,
        vs.secret_ref,
        vs.storage_backend,
        vsv.backend_secret_ref,
        ic.status AS credential_status,
        i.created_at,
        i.updated_at
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
      WHERE i.category = 'directory'
      ORDER BY FIELD(i.provider_code, 'ldap', 'wecom', 'dingtalk'), i.integration_code`,
    []
  )

  return rows.map(mapSource)
}

export async function getDirectorySource(providerCode: string) {
  const provider = assertProvider(providerCode)
  const rows = await queryRows<DirectorySourceRow[]>(
    `SELECT
        i.id,
        i.integration_code,
        i.integration_type,
        i.integration_name,
        i.provider_code,
        i.base_url,
        i.config_json,
        i.connectivity_status,
        i.last_checked_at,
        i.last_error_message,
        i.status,
        vs.secret_code,
        vs.secret_ref,
        vs.storage_backend,
        vsv.backend_secret_ref,
        ic.status AS credential_status,
        i.created_at,
        i.updated_at
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
      WHERE i.integration_code = ?
      LIMIT 1`,
    [integrationCode(provider)]
  )
  return rows[0] ? mapSource(rows[0]) : null
}

function resolveSecretValue(storageBackend: string | null, backendSecretRef: string | null) {
  if (!backendSecretRef) {
    throw createError({ statusCode: 409, message: 'Directory source credential has no backendSecretRef' })
  }

  if (storageBackend !== 'env_ref') {
    throw createError({
      statusCode: 501,
      message: `Directory source storageBackend=${storageBackend || 'unknown'} is not resolvable by the current Console runtime`
    })
  }

  const value = process.env[backendSecretRef]
  if (!value) {
    throw createError({
      statusCode: 503,
      message: `Directory source env secret ${backendSecretRef} is not set`
    })
  }

  return value
}

export async function getDirectorySourceRuntimeConfig(providerCode: DirectorySourceProvider) {
  const provider = assertProvider(providerCode)
  const row = await queryRow<DirectorySourceRuntimeRow>(
    `SELECT
        i.id,
        i.integration_code,
        i.integration_type,
        i.integration_name,
        i.provider_code,
        i.base_url,
        i.config_json,
        i.connectivity_status,
        i.last_checked_at,
        i.last_error_message,
        i.status,
        i.current_credential_id,
        vs.secret_code,
        vs.secret_ref,
        vs.storage_backend,
        vsv.backend_secret_ref,
        ic.status AS credential_status,
        i.created_at,
        i.updated_at
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
      WHERE i.integration_code = ?
      LIMIT 1`,
    [integrationCode(provider)]
  )

  if (!row) return null

  return {
    integrationId: row.id,
    integrationCode: row.integration_code,
    providerCode: provider,
    integrationName: row.integration_name,
    baseUrl: row.base_url,
    config: parseConfig(row.config_json),
    status: row.status,
    credential: {
      credentialId: row.current_credential_id,
      secretCode: row.secret_code,
      secretRef: row.secret_ref,
      storageBackend: row.storage_backend,
      backendSecretRef: row.backend_secret_ref,
      secretValue: resolveSecretValue(row.storage_backend, row.backend_secret_ref)
    }
  }
}

async function ensureVaultSecret(input: {
  providerCode: DirectorySourceProvider
  credential: DirectorySourceCredentialInput
  requestedBy: string | null
}) {
  const credential = input.credential
  const secretCode = credential.secretCode || defaultSecretCode(input.providerCode)
  const secretRef = `hzybase://vault/${secretCode}`

  return await withTransaction(async (tx) => {
    let secret = await tx.queryRow<SecretRow>(
      'SELECT id, current_version_id FROM vault_secrets WHERE secret_code = ? LIMIT 1',
      [secretCode]
    )

    if (!secret) {
      const result = await tx.execute<ResultSetHeader>(
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
          status,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'client_secret', 'integration', 'integration', ?, ?, 'approval', ?, 'active', ?, NOW(), NOW())`,
        [
          secretCode,
          secretRef,
          credential.secretName || `${defaultIntegrationName(input.providerCode)} Secret`,
          integrationCode(input.providerCode),
          credential.storageBackend,
          maskBackendSecretRef(credential.backendSecretRef),
          input.requestedBy
        ]
      )
      secret = { id: result.insertId, current_version_id: null } as SecretRow
    } else {
      await tx.execute<ResultSetHeader>(
        `UPDATE vault_secrets
            SET secret_name = ?,
                storage_backend = ?,
                masked_preview = ?,
                status = 'active',
                updated_at = NOW()
          WHERE id = ?`,
        [
          credential.secretName || `${defaultIntegrationName(input.providerCode)} Secret`,
          credential.storageBackend,
          maskBackendSecretRef(credential.backendSecretRef),
          secret.id
        ]
      )
    }

    const versionRow = await tx.queryRow<RowDataPacket & { version_no: number }>(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no FROM vault_secret_versions WHERE secret_id = ?',
      [secret.id]
    )
    const versionNo = Number(versionRow?.version_no || 1)

    const versionResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO vault_secret_versions (
        secret_id,
        version_no,
        backend_secret_ref,
        content_hash,
        encryption_scheme,
        status,
        activated_at,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, 'external_ref', 'active', NOW(), ?, NOW())`,
      [secret.id, versionNo, credential.backendSecretRef, hashRef(credential.backendSecretRef), input.requestedBy]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE vault_secret_versions
          SET status = 'retired', retired_at = COALESCE(retired_at, NOW())
        WHERE secret_id = ? AND id <> ? AND status = 'active'`,
      [secret.id, versionResult.insertId]
    )

    await tx.execute<ResultSetHeader>(
      'UPDATE vault_secrets SET current_version_id = ?, last_rotated_at = NOW(), updated_at = NOW() WHERE id = ?',
      [versionResult.insertId, secret.id]
    )

    return secret.id
  })
}

export async function upsertDirectorySource(input: UpsertDirectorySourceInput) {
  const providerCode = assertProvider(input.providerCode)
  const code = integrationCode(providerCode)
  const requestedBy = input.requestedBy || null
  const status = normalizeStatus(input.status)
  const config = input.config || {}
  const baseUrl = input.baseUrl || null

  let secretId: number | null = null
  if (input.credential) {
    secretId = await ensureVaultSecret({ providerCode, credential: input.credential, requestedBy })
  }

  const existing = await queryRow<IdRow>('SELECT id FROM integrations WHERE integration_code = ? LIMIT 1', [code])

  if (!existing) {
    const result = await execute<ResultSetHeader>(
      `INSERT INTO integrations (
        integration_code,
        integration_type,
        integration_name,
        category,
        provider_code,
        base_url,
        config_json,
        status,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, 'directory_source', ?, 'directory', ?, ?, ?, ?, ?, NOW(), NOW())`,
      [code, input.integrationName || defaultIntegrationName(providerCode), providerCode, baseUrl, JSON.stringify(config), status, requestedBy]
    )

    if (secretId) {
      const credentialResult = await execute<ResultSetHeader>(
        `INSERT INTO integration_credentials (
          integration_id,
          credential_name,
          credential_role,
          version_no,
          secret_id,
          status,
          issued_at
        ) VALUES (?, 'primary', 'primary', 1, ?, 'active', NOW())`,
        [result.insertId, secretId]
      )
      await execute<ResultSetHeader>(
        'UPDATE integrations SET current_credential_id = ?, updated_at = NOW() WHERE id = ?',
        [credentialResult.insertId, result.insertId]
      )
    }
  } else {
    await execute<ResultSetHeader>(
      `UPDATE integrations
          SET integration_name = ?,
              provider_code = ?,
              base_url = ?,
              config_json = ?,
              status = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [input.integrationName || defaultIntegrationName(providerCode), providerCode, baseUrl, JSON.stringify(config), status, existing.id]
    )

    if (secretId) {
      await execute<ResultSetHeader>(
        `UPDATE integration_credentials
            SET status = 'inactive'
          WHERE integration_id = ? AND status = 'active'`,
        [existing.id]
      )
      const versionRow = await queryRow<RowDataPacket & { version_no: number }>(
        'SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no FROM integration_credentials WHERE integration_id = ?',
        [existing.id]
      )
      const credentialResult = await execute<ResultSetHeader>(
        `INSERT INTO integration_credentials (
          integration_id,
          credential_name,
          credential_role,
          version_no,
          secret_id,
          status,
          issued_at
        ) VALUES (?, 'primary', 'primary', ?, ?, 'active', NOW())`,
        [existing.id, Number(versionRow?.version_no || 1), secretId]
      )
      await execute<ResultSetHeader>(
        'UPDATE integrations SET current_credential_id = ?, updated_at = NOW() WHERE id = ?',
        [credentialResult.insertId, existing.id]
      )
    }
  }

  return await getDirectorySource(providerCode)
}
