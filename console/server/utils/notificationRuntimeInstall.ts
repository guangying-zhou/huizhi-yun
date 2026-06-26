import { randomBytes } from 'node:crypto'
import { createError, getRequestURL, type H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { getOidcIssuer } from '~~/server/utils/oidc'
import { getSystemParameter } from '~~/server/utils/systemParameters'
import { loadActivationStatus, loadPlatformRuntimeConfig } from '~~/server/utils/platformRuntime'
import {
  addVaultSecretVersion,
  createVaultSecret,
  resolveVaultSecret,
  type VaultActor
} from '~~/server/utils/vault'

const CLIENT_CODE = 'notification-runtime'
const CLIENT_NAME = 'Notification Runtime'
const CLIENT_TYPE = 'supporting_service'
const SECRET_CODE = 'svc.notification-runtime.client_secret'
const DEFAULT_PACKAGE_BASE_URL = 'https://downloads.huizhi.yun/packages/hzy-notification-runtime'
const DEFAULT_PORT = '18081'
const REQUIRED_GRANTS = [
  'integration_config:view',
  'credential_vault:resolve'
] as const

interface SecretRow extends RowDataPacket {
  id: number
  maskedPreview: string | null
}

interface ServiceClientRow extends RowDataPacket {
  id: number
}

interface CredentialRow extends RowDataPacket {
  id: number
  serviceClientId: number
}

interface VersionNoRow extends RowDataPacket {
  versionNo: number
}

export interface NotificationRuntimeInstallCommand {
  packageBaseUrl: string
  consoleApiUrl: string
  tokenUrl: string
  issuer: string
  jwksUrl: string
  audience: string
  clientId: string
  clientSecretLast4: string | null
  tenantCode: string
  deploymentCode: string
  port: string
  runtimeApiUrl: string | null
  serviceName: string
  updateTimer: string
  rotated: boolean
  installCommand: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function shellQuote(value: string) {
  const quote = String.fromCharCode(39)
  return `${quote}${value.replace(/'/g, `${quote}\\${quote}${quote}`)}${quote}`
}

function tokenLast4(value: string) {
  return value ? value.slice(-4) : null
}

function generateClientSecret() {
  return `hzy_nr_${randomBytes(32).toString('base64url')}`
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

function isRecoverableSecretResolveError(error: unknown) {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
  return statusCode === 404 || statusCode === 409
}

function actorId(actor: VaultActor) {
  return actor.actorId || actor.actorType || 'system'
}

async function findSecret() {
  return await queryRow<SecretRow>(
    `SELECT id,
            masked_preview AS maskedPreview
       FROM vault_secrets
      WHERE secret_code = ?
        AND status = 'active'
      LIMIT 1`,
    [SECRET_CODE]
  )
}

async function resolveExistingClientSecret(event: H3Event, actor: VaultActor) {
  try {
    const resolved = await resolveVaultSecret({
      event,
      secretCode: SECRET_CODE,
      actor,
      purpose: 'notification_runtime_install_command'
    })
    return resolved.value
  } catch (error) {
    if (isRecoverableSecretResolveError(error)) {
      return ''
    }
    throw error
  }
}

async function writeClientSecretVersion(event: H3Event, actor: VaultActor, clientSecret: string) {
  const existing = await findSecret()
  if (existing) {
    await addVaultSecretVersion({
      secretCode: SECRET_CODE,
      storageBackend: 'db_encrypted',
      material: { plaintext: clientSecret },
      setCurrent: true,
      action: 'rotate',
      createdBy: actorId(actor)
    }, event)
    return
  }

  try {
    await createVaultSecret({
      secretCode: SECRET_CODE,
      secretName: `${CLIENT_NAME} client secret`,
      secretType: 'client_secret',
      usageType: 'service',
      ownerType: 'service_client',
      ownerKey: CLIENT_CODE,
      storageBackend: 'db_encrypted',
      revealPolicy: 'approval',
      material: { plaintext: clientSecret },
      createdBy: actorId(actor)
    }, event)
  } catch (error) {
    const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
    if (statusCode !== 409) {
      throw error
    }
    await addVaultSecretVersion({
      secretCode: SECRET_CODE,
      storageBackend: 'db_encrypted',
      material: { plaintext: clientSecret },
      setCurrent: true,
      action: 'rotate',
      createdBy: actorId(actor)
    }, event)
  }
}

async function ensureClientSecret(event: H3Event, actor: VaultActor, rotate: boolean) {
  if (!rotate) {
    const existing = await resolveExistingClientSecret(event, actor)
    if (existing) {
      return {
        clientSecret: existing,
        rotated: false
      }
    }
  }

  const clientSecret = generateClientSecret()
  await writeClientSecretVersion(event, actor, clientSecret)
  return {
    clientSecret,
    rotated: true
  }
}

async function ensureServiceClient(input: { clientId: string }) {
  const secret = await findSecret()
  if (!secret) {
    throw createError({
      statusCode: 500,
      message: `failed to resolve notification-runtime secret: ${SECRET_CODE}`
    })
  }

  await withTransaction(async (tx) => {
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
       ) VALUES (?, ?, ?, NULL, 'Generated by Console notification-runtime installer', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         client_name = VALUES(client_name),
         client_type = VALUES(client_type),
         app_code = NULL,
         description = VALUES(description),
         status = 'active',
         updated_at = UTC_TIMESTAMP()`,
      [CLIENT_CODE, CLIENT_NAME, CLIENT_TYPE]
    )

    const serviceClient = await tx.queryRow<ServiceClientRow>(
      'SELECT id FROM service_clients WHERE client_code = ? LIMIT 1',
      [CLIENT_CODE]
    )
    if (!serviceClient) {
      throw createError({ statusCode: 500, message: `failed to create service client: ${CLIENT_CODE}` })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE service_client_credentials
          SET status = 'retired'
        WHERE service_client_id = ?
          AND client_id <> ?
          AND status = 'active'`,
      [serviceClient.id, input.clientId]
    )

    let credential = await tx.queryRow<CredentialRow>(
      `SELECT id,
              service_client_id AS serviceClientId
         FROM service_client_credentials
        WHERE client_id = ?
        LIMIT 1`,
      [input.clientId]
    )

    if (credential) {
      if (credential.serviceClientId !== serviceClient.id) {
        await tx.execute<ResultSetHeader>(
          `UPDATE service_clients
              SET current_credential_id = NULL,
                  updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND current_credential_id = ?`,
          [credential.serviceClientId, credential.id]
        )
      }

      await tx.execute<ResultSetHeader>(
        `UPDATE service_client_credentials
            SET service_client_id = ?,
                secret_id = ?,
                status = 'active'
          WHERE id = ?`,
        [serviceClient.id, secret.id, credential.id]
      )
    } else {
      const versionRow = await tx.queryRow<VersionNoRow>(
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
      credential = {
        id: inserted.insertId,
        serviceClientId: serviceClient.id
      } as CredentialRow
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

    for (const scope of REQUIRED_GRANTS) {
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
          JSON.stringify({ source: 'notification-runtime-install-command' })
        ]
      )
    }
  })
}

async function resolveRuntimeContext(event: H3Event) {
  let tenantCode = stringValue(process.env.HZY_NOTIFICATION_RUNTIME_TENANT || process.env.HZY_TENANT)
  let deploymentCode = stringValue(process.env.HZY_NOTIFICATION_RUNTIME_DEPLOYMENT || process.env.HZY_DEPLOYMENT)

  try {
    const config = loadPlatformRuntimeConfig(event)
    tenantCode ||= config.tenantCode
    deploymentCode ||= config.deploymentCode
  } catch {
    // Platform runtime can be disabled in local dev; fall back below.
  }

  try {
    const status = await loadActivationStatus(event)
    tenantCode ||= stringValue(status.tenantCode)
    deploymentCode ||= stringValue(status.deploymentCode)
  } catch {
    // Activation status is best-effort metadata for the installer.
  }

  return {
    tenantCode: tenantCode || 'default',
    deploymentCode: deploymentCode || 'local',
    port: stringValue(process.env.HZY_NOTIFICATION_RUNTIME_PORT) || DEFAULT_PORT
  }
}

export async function getNotificationRuntimeInstallMetadata(event: H3Event): Promise<NotificationRuntimeInstallCommand> {
  const requestOrigin = normalizeBaseUrl(getRequestURL(event).origin)
  const issuer = normalizeBaseUrl(getOidcIssuer(event) || requestOrigin)
  const consoleApiUrl = normalizeBaseUrl(
    stringValue(process.env.HZY_NOTIFICATION_RUNTIME_CONSOLE_API_URL)
    || stringValue(process.env.HZY_CONSOLE_API_URL)
    || issuer
    || requestOrigin
  )
  const packageBaseUrl = normalizeBaseUrl(
    stringValue(process.env.HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL)
    || DEFAULT_PACKAGE_BASE_URL
  )
  const clientId = stringValue(process.env.HZY_NOTIFICATION_RUNTIME_CLIENT_ID) || CLIENT_CODE
  const runtimeApiUrl = await getSystemParameter('notification.runtimeApiUrl').catch(() => null)
  const context = await resolveRuntimeContext(event)
  const secret = await findSecret().catch(() => null)
  const clientSecretLast4 = secret?.maskedPreview ? secret.maskedPreview.slice(-4) : null

  return {
    packageBaseUrl,
    consoleApiUrl,
    tokenUrl: `${consoleApiUrl}/oauth/token`,
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    audience: CLIENT_CODE,
    clientId,
    clientSecretLast4,
    tenantCode: context.tenantCode,
    deploymentCode: context.deploymentCode,
    port: context.port,
    runtimeApiUrl,
    serviceName: 'hzy-notification-runtime',
    updateTimer: 'hzy-notification-runtime-update.timer',
    rotated: false,
    installCommand: ''
  }
}

function buildInstallCommand(input: NotificationRuntimeInstallCommand & { clientSecret: string }) {
  return [
    `curl -fsSL ${shellQuote(`${input.packageBaseUrl}/install.sh`)} | \\`,
    '  sudo env \\',
    `    HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL=${shellQuote(input.packageBaseUrl)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_PORT=${shellQuote(input.port)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_TENANT=${shellQuote(input.tenantCode)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_DEPLOYMENT=${shellQuote(input.deploymentCode)} \\`,
    `    HZY_CONSOLE_API_URL=${shellQuote(input.consoleApiUrl)} \\`,
    `    HZY_CONSOLE_TOKEN_URL=${shellQuote(input.tokenUrl)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_AUTH_MODE=${shellQuote('jwt')} \\`,
    `    HZY_NOTIFICATION_RUNTIME_AUDIENCE=${shellQuote(input.audience)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_JWT_ISSUER=${shellQuote(input.issuer)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_JWKS_URL=${shellQuote(input.jwksUrl)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_CLIENT_ID=${shellQuote(input.clientId)} \\`,
    `    HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET=${shellQuote(input.clientSecret)} \\`,
    '    bash'
  ].join('\n')
}

export async function generateNotificationRuntimeInstallCommand(input: {
  event: H3Event
  actor: VaultActor
  rotate?: boolean
}): Promise<NotificationRuntimeInstallCommand> {
  const metadata = await getNotificationRuntimeInstallMetadata(input.event)
  const { clientSecret, rotated } = await ensureClientSecret(input.event, input.actor, Boolean(input.rotate))
  await ensureServiceClient({ clientId: metadata.clientId })

  return {
    ...metadata,
    clientSecretLast4: tokenLast4(clientSecret),
    rotated,
    installCommand: buildInstallCommand({
      ...metadata,
      clientSecret
    })
  }
}
