import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { hashOpaqueValue } from '~~/server/utils/oidc'
import { isTrustedTenantGatewayRequest } from '~~/server/utils/platformRuntime'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { resolveVaultSecret, type VaultActor } from '~~/server/utils/vault'

interface ServiceClientCredentialRow extends RowDataPacket {
  serviceClientId: number
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
  serviceClientStatus: string
  credentialId: number
  clientId: string
  credentialStatus: string
  expiresAt: string | null
  secretId: number
  versionId: number | null
  storageBackend: string
  backendSecretRef: string | null
  contentHash: string | null
}

interface ServiceClientGrantRow extends RowDataPacket {
  resourceCode: string
  action: string
  scopeJson: string | Record<string, unknown> | null
}

interface SecretCurrentRow extends RowDataPacket {
  id: number
  currentVersionId: number | null
  versionId: number | null
  backendSecretRef: string | null
  contentHash: string | null
}

interface ServiceClientIdRow extends RowDataPacket {
  id: number
  currentCredentialId: number | null
}

interface CredentialIdRow extends RowDataPacket {
  id: number
}

interface BootstrapServiceClientRow extends RowDataPacket {
  serviceClientId: number
  credentialId: number
  clientId: string
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
  serviceClientStatus: string
  credentialStatus: string
  expiresAt: string | null
}

export interface ServiceClientTokenSubject {
  serviceClientId: number
  credentialId: number
  clientId: string
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
  scope: string
}

export interface ServiceClientMaterializeResult {
  scanned: number
  materialized: number
  grants: number
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function maskSecret(value: string) {
  if (!value) return null
  if (value.length <= 8) return '********'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function secretMatches(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function hashMatches(storedHash: string | null, secret: string) {
  if (!storedHash) return false
  const normalized = stringValue(storedHash)
  const modernHash = hashOpaqueValue(secret)
  const legacyHash = modernHash.replace(/^sha256_/, '')
  return secretMatches(normalized, modernHash) || secretMatches(normalized, legacyHash)
}

function grantScope(resourceCode: string, action: string) {
  return `${resourceCode}:${action}`
}

function parseScope(scope: string) {
  const normalized = stringValue(scope)
  const index = normalized.lastIndexOf(':')
  if (index <= 0 || index === normalized.length - 1) {
    return null
  }

  return {
    resourceCode: normalized.slice(0, index),
    action: normalized.slice(index + 1)
  }
}

function requestedScopes(scope: unknown) {
  return [...new Set(stringValue(scope).split(/\s+/).map(item => item.trim()).filter(Boolean))].sort()
}

function resolveEnvSecret(row: ServiceClientCredentialRow) {
  if (row.storageBackend !== 'env_ref') {
    return null
  }

  const envName = stringValue(row.backendSecretRef)
  return envName ? stringValue(process.env[envName]) : ''
}

async function writeVaultValidationLog(row: ServiceClientCredentialRow, resultStatus: 'success' | 'failed') {
  await execute<ResultSetHeader>(
    `INSERT INTO vault_access_logs (
       secret_id,
       version_id,
       action,
       actor_type,
       actor_id,
       app_code,
       reason,
       result_status,
       created_at
     ) VALUES (?, ?, 'validate', 'service', ?, ?, 'oauth.client_credentials', ?, UTC_TIMESTAMP())`,
    [
      row.secretId,
      row.versionId,
      row.clientCode,
      row.appCode,
      resultStatus
    ]
  ).catch(() => undefined)
}

async function loadCredential(clientId: string) {
  return await queryRow<ServiceClientCredentialRow>(
    `SELECT sc.id AS serviceClientId,
            sc.client_code AS clientCode,
            sc.client_name AS clientName,
            sc.client_type AS clientType,
            sc.app_code AS appCode,
            sc.status AS serviceClientStatus,
            scc.id AS credentialId,
            scc.client_id AS clientId,
            scc.status AS credentialStatus,
            scc.expires_at AS expiresAt,
            vs.id AS secretId,
            vsv.id AS versionId,
            vs.storage_backend AS storageBackend,
            vsv.backend_secret_ref AS backendSecretRef,
            vsv.content_hash AS contentHash
       FROM service_client_credentials scc
       INNER JOIN service_clients sc ON sc.id = scc.service_client_id
       INNER JOIN vault_secrets vs ON vs.id = scc.secret_id
       LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
      WHERE scc.client_id = ?
      LIMIT 1`,
    [clientId]
  )
}

async function loadGrantScopes(serviceClientId: number) {
  const grants = await queryRows<ServiceClientGrantRow[]>(
    `SELECT resource_code AS resourceCode,
            action,
            scope_json AS scopeJson
       FROM service_client_grants
      WHERE service_client_id = ?
        AND status = 'active'
      ORDER BY resource_code, action`,
    [serviceClientId]
  )
  return grants.map(row => grantScope(row.resourceCode, row.action)).sort()
}

function assertRequestedScopes(input: { audience: string, requested: string[], allowed: string[] }) {
  const audiencePrefix = `${input.audience}:`
  const allowedSet = new Set(input.allowed)
  const scopes = input.requested.length
    ? input.requested
    : input.allowed.filter(scope => scope.startsWith(audiencePrefix))

  if (!scopes.length) {
    throw createError({ statusCode: 400, message: 'invalid_scope: no grant available for requested audience' })
  }

  const invalidAudience = scopes.filter(scope => !scope.startsWith(audiencePrefix))
  if (invalidAudience.length) {
    throw createError({ statusCode: 400, message: `invalid_scope: scope does not match audience ${input.audience}` })
  }

  const denied = scopes.filter(scope => !allowedSet.has(scope))
  if (denied.length) {
    throw createError({ statusCode: 403, message: `insufficient_scope: ${denied.join(' ')}` })
  }

  return scopes.sort().join(' ')
}

export async function consumeServiceClientCredentials(input: {
  clientId: unknown
  clientSecret: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  const clientId = stringValue(input.clientId)
  const clientSecret = stringValue(input.clientSecret)
  const audience = stringValue(input.audience)

  if (!clientId || !clientSecret) {
    throw createError({ statusCode: 401, message: 'invalid_client: client_id and client_secret are required' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }

  const credential = await loadCredential(clientId)
  if (!credential) {
    throw createError({ statusCode: 401, message: 'invalid_client' })
  }

  if (credential.serviceClientStatus !== 'active' || credential.credentialStatus !== 'active') {
    await writeVaultValidationLog(credential, 'failed')
    throw createError({ statusCode: 401, message: 'invalid_client' })
  }
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= Date.now()) {
    await writeVaultValidationLog(credential, 'failed')
    throw createError({ statusCode: 401, message: 'invalid_client: credential expired' })
  }

  const envSecret = resolveEnvSecret(credential)
  const validSecret = envSecret
    ? secretMatches(clientSecret, envSecret)
    : hashMatches(credential.contentHash, clientSecret)

  if (!validSecret) {
    await writeVaultValidationLog(credential, 'failed')
    throw createError({ statusCode: 401, message: 'invalid_client' })
  }

  const allowedScopes = await loadGrantScopes(credential.serviceClientId)
  const scope = assertRequestedScopes({
    audience,
    requested: requestedScopes(input.scope),
    allowed: allowedScopes
  })

  await Promise.all([
    execute<ResultSetHeader>(
      'UPDATE service_client_credentials SET last_used_at = UTC_TIMESTAMP() WHERE id = ?',
      [credential.credentialId]
    ),
    writeVaultValidationLog(credential, 'success')
  ])

  return {
    serviceClientId: credential.serviceClientId,
    credentialId: credential.credentialId,
    clientId: credential.clientId,
    clientCode: credential.clientCode,
    clientName: credential.clientName,
    clientType: credential.clientType,
    appCode: credential.appCode,
    scope
  }
}

export async function consumeRuntimeAppIdentity(input: {
  event: H3Event
  appCode: unknown
  clientId?: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  if (!isTrustedTenantGatewayRequest(input.event)) {
    throw createError({ statusCode: 401, message: 'invalid_client: trusted runtime app identity is required' })
  }

  const headerAppCode = stringValue(getHeader(input.event, 'x-hzy-app-code'))
  const requestedAppCode = stringValue(input.appCode)
  const clientId = stringValue(input.clientId)
  const audience = stringValue(input.audience)

  if (!headerAppCode) {
    throw createError({ statusCode: 401, message: 'invalid_client: runtime app code is required' })
  }
  if (requestedAppCode && requestedAppCode !== headerAppCode) {
    throw createError({ statusCode: 403, message: 'invalid_client: runtime app code mismatch' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }

  const serviceClient = await loadBootstrapServiceClient(headerAppCode)
  if (!serviceClient) {
    throw createError({ statusCode: 404, message: `service client not found for app: ${headerAppCode}` })
  }
  if (serviceClient.expiresAt && new Date(serviceClient.expiresAt).getTime() <= Date.now()) {
    throw createError({ statusCode: 401, message: 'invalid_client: credential expired' })
  }

  const acceptedClientIds = new Set([
    serviceClient.clientId,
    serviceClient.clientCode,
    headerAppCode,
    `${headerAppCode}.runtime`
  ].map(stringValue).filter(Boolean))
  if (clientId && !acceptedClientIds.has(clientId)) {
    throw createError({ statusCode: 401, message: 'invalid_client: client_id does not match runtime app identity' })
  }

  const allowedScopes = await loadGrantScopes(serviceClient.serviceClientId)
  const scope = assertRequestedScopes({
    audience,
    requested: requestedScopes(input.scope),
    allowed: allowedScopes
  })

  await execute<ResultSetHeader>(
    'UPDATE service_client_credentials SET last_used_at = UTC_TIMESTAMP() WHERE id = ?',
    [serviceClient.credentialId]
  ).catch(() => undefined)

  return {
    serviceClientId: serviceClient.serviceClientId,
    credentialId: serviceClient.credentialId,
    clientId: serviceClient.clientId,
    clientCode: serviceClient.clientCode,
    clientName: serviceClient.clientName,
    clientType: serviceClient.clientType,
    appCode: serviceClient.appCode,
    scope
  }
}

async function loadBootstrapServiceClient(appCode: string) {
  return await queryRow<BootstrapServiceClientRow>(
    `SELECT sc.id AS serviceClientId,
            scc.id AS credentialId,
            scc.client_id AS clientId,
            sc.client_code AS clientCode,
            sc.client_name AS clientName,
            sc.client_type AS clientType,
            sc.app_code AS appCode,
            sc.status AS serviceClientStatus,
            scc.status AS credentialStatus,
            scc.expires_at AS expiresAt
       FROM service_clients sc
       INNER JOIN service_client_credentials scc ON scc.id = sc.current_credential_id
      WHERE (sc.app_code = ? OR sc.client_code = ? OR sc.client_code = ?)
        AND sc.status = 'active'
        AND scc.status = 'active'
      ORDER BY
        CASE
          WHEN sc.app_code = ? THEN 0
          WHEN sc.client_code = ? THEN 1
          ELSE 2
        END
      LIMIT 1`,
    [appCode, appCode, `${appCode}.runtime`, appCode, appCode]
  )
}

export async function consumeBootstrapAccessKey(input: {
  event: Parameters<typeof resolveVaultSecret>[0]['event']
  appCode: unknown
  deploymentCode: unknown
  accessKey: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  const appCode = stringValue(input.appCode)
  const deploymentCode = stringValue(input.deploymentCode)
  const accessKey = stringValue(input.accessKey)
  const audience = stringValue(input.audience)

  if (!appCode || !deploymentCode) {
    throw createError({ statusCode: 401, message: 'invalid_bootstrap: appCode and deploymentCode are required' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }

  if (accessKey) {
    const actor: VaultActor = {
      actorType: 'system',
      actorId: `bootstrap:${deploymentCode}`,
      appCode
    }
    const secret = await resolveVaultSecret({
      event: input.event,
      secretCode: `bootstrap.${deploymentCode}.access_key`,
      actor,
      purpose: 'bootstrap_service_token'
    })
    if (!secretMatches(accessKey, secret.value)) {
      throw createError({ statusCode: 401, message: 'invalid_bootstrap' })
    }
  }

  const serviceClient = await loadBootstrapServiceClient(appCode)
  if (!serviceClient) {
    throw createError({ statusCode: 404, message: `service client not found for app: ${appCode}` })
  }
  if (serviceClient.expiresAt && new Date(serviceClient.expiresAt).getTime() <= Date.now()) {
    throw createError({ statusCode: 401, message: 'invalid_client: credential expired' })
  }

  const allowedScopes = await loadGrantScopes(serviceClient.serviceClientId)
  const scope = assertRequestedScopes({
    audience,
    requested: requestedScopes(input.scope),
    allowed: allowedScopes
  })

  return {
    serviceClientId: serviceClient.serviceClientId,
    credentialId: serviceClient.credentialId,
    clientId: serviceClient.clientId,
    clientCode: serviceClient.clientCode,
    clientName: serviceClient.clientName,
    clientType: serviceClient.clientType,
    appCode: serviceClient.appCode,
    scope
  }
}

function serviceClientEnvConfigs() {
  const configs = []
  const seen = new Set<string>()
  for (const key of Object.keys(process.env).sort()) {
    const match = key.match(/^HZY_SERVICE_CLIENT_([A-Z0-9_]+)_SECRET$/)
    if (!match) continue
    const envPart = match[1]
    if (!envPart || seen.has(envPart)) continue
    seen.add(envPart)

    const appCode = envPart.toLowerCase().replace(/_/g, '-')
    const secret = stringValue(process.env[key])
    const grants = stringValue(process.env[`HZY_SERVICE_CLIENT_${envPart}_GRANTS`])
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean)

    if (!secret || grants.length === 0) continue

    configs.push({
      appCode,
      envPart,
      secretEnvName: key,
      secret,
      grants,
      clientCode: stringValue(process.env[`HZY_SERVICE_CLIENT_${envPart}_CLIENT_CODE`]) || `${appCode}.runtime`,
      clientId: stringValue(process.env[`HZY_SERVICE_CLIENT_${envPart}_CLIENT_ID`]) || `${appCode}.runtime`,
      clientName: stringValue(process.env[`HZY_SERVICE_CLIENT_${envPart}_CLIENT_NAME`]) || `${appCode} Runtime`,
      clientType: stringValue(process.env[`HZY_SERVICE_CLIENT_${envPart}_CLIENT_TYPE`]) || 'app'
    })
  }

  return configs
}

async function upsertEnvServiceClient(input: ReturnType<typeof serviceClientEnvConfigs>[number]) {
  return await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO service_clients (
         client_code,
         client_name,
         client_type,
         app_code,
         description,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, 'Bootstrapped from Console environment', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         client_name = VALUES(client_name),
         client_type = VALUES(client_type),
         app_code = VALUES(app_code),
         status = 'active',
         updated_at = UTC_TIMESTAMP()`,
      [input.clientCode, input.clientName, input.clientType, input.appCode]
    )

    const serviceClient = await tx.queryRow<ServiceClientIdRow>(
      'SELECT id, current_credential_id AS currentCredentialId FROM service_clients WHERE client_code = ? LIMIT 1',
      [input.clientCode]
    )
    if (!serviceClient) {
      throw createError({ statusCode: 500, message: `failed to create service client: ${input.clientCode}` })
    }

    const secretCode = `svc.${input.clientCode}.client_secret`
    const secretRef = `hzybase://vault/${secretCode}`
    const contentHash = hashOpaqueValue(input.secret)

    await tx.execute<ResultSetHeader>(
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
       ) VALUES (?, ?, ?, 'client_secret', 'service', 'service_client', ?, 'env_ref', 'approval', ?, 'active', 'system', UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         secret_name = VALUES(secret_name),
         secret_type = 'client_secret',
         usage_type = 'service',
         owner_type = 'service_client',
         owner_key = VALUES(owner_key),
         storage_backend = 'env_ref',
         reveal_policy = 'approval',
         masked_preview = VALUES(masked_preview),
         status = 'active',
         updated_at = UTC_TIMESTAMP()`,
      [
        secretCode,
        secretRef,
        `${input.clientName} Secret`,
        input.clientCode,
        maskSecret(input.secret)
      ]
    )

    const secret = await tx.queryRow<SecretCurrentRow>(
      `SELECT vs.id,
              vs.current_version_id AS currentVersionId,
              vsv.id AS versionId,
              vsv.backend_secret_ref AS backendSecretRef,
              vsv.content_hash AS contentHash
         FROM vault_secrets vs
         LEFT JOIN vault_secret_versions vsv ON vsv.id = vs.current_version_id
        WHERE vs.secret_code = ?
        LIMIT 1`,
      [secretCode]
    )
    if (!secret) {
      throw createError({ statusCode: 500, message: `failed to create service client secret: ${secretCode}` })
    }

    let secretVersionId = secret.versionId
    if (secret.backendSecretRef !== input.secretEnvName || secret.contentHash !== contentHash) {
      const versionRow = await tx.queryRow<RowDataPacket & { versionNo: number }>(
        'SELECT COALESCE(MAX(version_no), 0) + 1 AS versionNo FROM vault_secret_versions WHERE secret_id = ?',
        [secret.id]
      )
      const inserted = await tx.execute<ResultSetHeader>(
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
         ) VALUES (?, ?, ?, ?, 'external_ref', 'active', UTC_TIMESTAMP(), 'system', UTC_TIMESTAMP())`,
        [
          secret.id,
          Number(versionRow?.versionNo || 1),
          input.secretEnvName,
          contentHash
        ]
      )
      secretVersionId = inserted.insertId

      await tx.execute<ResultSetHeader>(
        `UPDATE vault_secret_versions
            SET status = 'retired',
                retired_at = COALESCE(retired_at, UTC_TIMESTAMP())
          WHERE secret_id = ?
            AND id <> ?
            AND status = 'active'`,
        [secret.id, secretVersionId]
      )

      await tx.execute<ResultSetHeader>(
        'UPDATE vault_secrets SET current_version_id = ?, last_rotated_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?',
        [secretVersionId, secret.id]
      )
    }

    let credential = await tx.queryRow<CredentialIdRow>(
      'SELECT id FROM service_client_credentials WHERE client_id = ? LIMIT 1',
      [input.clientId]
    )

    if (credential) {
      await tx.execute<ResultSetHeader>(
        `UPDATE service_client_credentials
            SET status = 'retired'
          WHERE service_client_id = ?
            AND id <> ?
            AND status = 'active'`,
        [serviceClient.id, credential.id]
      )
      await tx.execute<ResultSetHeader>(
        `UPDATE service_client_credentials
            SET service_client_id = ?,
                secret_id = ?,
                status = 'active'
          WHERE id = ?`,
        [serviceClient.id, secret.id, credential.id]
      )
    } else {
      const versionRow = await tx.queryRow<RowDataPacket & { versionNo: number }>(
        'SELECT COALESCE(MAX(version_no), 0) + 1 AS versionNo FROM service_client_credentials WHERE service_client_id = ?',
        [serviceClient.id]
      )
      const inserted = await tx.execute<ResultSetHeader>(
        `INSERT INTO service_client_credentials (
           service_client_id,
           client_id,
           version_no,
           secret_id,
           issued_at,
           status
         ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 'active')`,
        [
          serviceClient.id,
          input.clientId,
          Number(versionRow?.versionNo || 1),
          secret.id
        ]
      )
      credential = { id: inserted.insertId } as CredentialIdRow
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE service_client_credentials
          SET status = 'retired'
        WHERE service_client_id = ?
          AND id <> ?
          AND status = 'active'`,
      [serviceClient.id, credential.id]
    )

    await tx.execute<ResultSetHeader>(
      'UPDATE service_clients SET current_credential_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [credential.id, serviceClient.id]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE service_client_grants
          SET status = 'inactive',
              updated_at = UTC_TIMESTAMP()
        WHERE service_client_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(scope_json, '$.source')) = 'env'`,
      [serviceClient.id]
    )

    let grantCount = 0
    for (const scope of input.grants) {
      const grant = parseScope(scope)
      if (!grant) continue
      await tx.execute<ResultSetHeader>(
        `INSERT INTO service_client_grants (
           service_client_id,
           resource_code,
           action,
           scope_json,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, CAST(? AS JSON), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           scope_json = VALUES(scope_json),
           status = 'active',
           updated_at = UTC_TIMESTAMP()`,
        [
          serviceClient.id,
          grant.resourceCode,
          grant.action,
          JSON.stringify({ source: 'env' })
        ]
      )
      grantCount += 1
    }

    if (!secretVersionId) {
      throw createError({ statusCode: 500, message: `failed to resolve service client secret version: ${secretCode}` })
    }

    return grantCount
  })
}

export async function materializeServiceClientsFromEnv(): Promise<ServiceClientMaterializeResult> {
  const configs = serviceClientEnvConfigs()
  let materialized = 0
  let grants = 0

  for (const config of configs) {
    const grantCount = await upsertEnvServiceClient(config)
    materialized += 1
    grants += grantCount
  }

  return {
    scanned: configs.length,
    materialized,
    grants
  }
}
