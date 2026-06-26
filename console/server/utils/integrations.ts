import { createError, getRequestURL, type H3Event } from 'h3'
import OSS from 'ali-oss'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { issueServiceAccessToken } from '~~/server/utils/oidc'
import { getSystemParameter } from '~~/server/utils/systemParameters'
import { resolveVaultSecret, type VaultActor } from '~~/server/utils/vault'

const NOTIFICATION_RUNTIME_CLIENT_CODE = 'notification-runtime'
const NOTIFICATION_RUNTIME_AUDIENCE = 'notification-runtime'
const NOTIFICATION_RUNTIME_SEND_SCOPE = 'notification-runtime:send'

interface IntegrationRow extends RowDataPacket {
  id: number
  integrationCode: string
  integrationType: string
  integrationName: string
  category: string
  providerCode: string | null
  baseUrl: string | null
  configJson: string | Record<string, unknown> | null
  connectivityStatus: string
  lastCheckedAt: string | null
  lastErrorMessage: string | null
  status: string
  credentialName: string | null
  credentialVersionNo: number | null
  secretCode: string | null
  secretRef: string | null
  secretUsageType: string | null
  secretVersionNo: number | null
  credentialStatus: string | null
  createdAt: string
  updatedAt: string
}

interface IdRow extends RowDataPacket {
  id: number
}

interface IntegrationIdRow extends RowDataPacket {
  id: number
  currentCredentialId: number | null
}

interface SecretBindingRow extends RowDataPacket {
  secretId: number
  secretCode: string
  secretRef: string
  usageType: string
  versionId: number
  versionNo: number
}

interface CredentialRow extends RowDataPacket {
  id: number
  versionNo: number
  rotatedFromId: number | null
}

interface NotificationRuntimeServiceClientRow extends RowDataPacket {
  credentialId: number
  clientId: string
  clientCode: string
  clientName: string
  clientType: string
  appCode: string | null
}

interface ServiceClientGrantRow extends RowDataPacket {
  scope: string
}

interface WecomTokenResponse {
  errcode: number
  errmsg?: string
  access_token?: string
  expires_in?: number
}

interface WecomSendResponse {
  errcode: number
  errmsg?: string
  invaliduser?: string
  [key: string]: unknown
}

type DbExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface IntegrationCredentialInput {
  secretCode?: unknown
  versionNo?: unknown
  expiresAt?: unknown
}

export interface UpsertIntegrationInput {
  integrationCode?: unknown
  integrationType?: unknown
  integrationName?: unknown
  category?: unknown
  providerCode?: unknown
  baseUrl?: unknown
  config?: Record<string, unknown> | null
  credential?: IntegrationCredentialInput | null
  status?: unknown
  requestedBy?: unknown
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function assertCode(value: unknown, field: string) {
  const normalized = stringValue(value)
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,126}[a-zA-Z0-9]$/.test(normalized)) {
    throw createError({ statusCode: 400, message: `${field} is invalid` })
  }
  return normalized
}

function parseConfig(value: IntegrationRow['configJson']) {
  if (!value) return {}
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>
  }
  return value
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && stringValue(value)) {
      return stringValue(value)
    }
  }
  return ''
}

function assertConfigHasNoSecret(value: unknown, path = 'config') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (/(secret|password|private[_-]?key|access[_-]?key[_-]?secret|api[_-]?key|token)$/i.test(key)) {
      throw createError({ statusCode: 400, message: `${childPath} must be stored in vault, not integration config` })
    }
    assertConfigHasNoSecret(child, childPath)
  }
}

function assertStatus(value: unknown) {
  const normalized = stringValue(value || 'active')
  if (!['active', 'inactive'].includes(normalized)) {
    throw createError({ statusCode: 400, message: 'status is invalid' })
  }
  return normalized
}

function toSqlJson(value: Record<string, unknown> | null | undefined) {
  const config = value || {}
  assertConfigHasNoSecret(config)
  return JSON.stringify(config)
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

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function joinProviderUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  let normalizedPath = stringValue(path).trim()
  if (!normalizedPath) return base
  normalizedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  if (base.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    normalizedPath = normalizedPath.slice('/v1'.length)
  }
  return `${base}${normalizedPath}`
}

function normalizeWecomBaseUrl(baseUrl: string | null) {
  return stringValue(baseUrl || 'https://qyapi.weixin.qq.com').replace(/\/+$/, '')
}

function normalizeBaseUrl(value: string | null) {
  return stringValue(value).replace(/\/+$/, '')
}

function assertWecomConfig(config: Record<string, unknown>) {
  const corpid = getConfigValue(config, ['corpid', 'corpId'])
  const agentid = getConfigValue(config, ['agentid', 'agentId'])
  if (!corpid) {
    throw createError({ statusCode: 400, message: 'WeCom corpid is required' })
  }
  const agentIdNumber = Number(agentid)
  if (!agentid || !Number.isFinite(agentIdNumber) || agentIdNumber <= 0) {
    throw createError({ statusCode: 400, message: 'WeCom agentid is required' })
  }
  return {
    corpid,
    agentid: Math.floor(agentIdNumber)
  }
}

async function requestWecomAccessToken(baseUrl: string, corpid: string, corpsecret: string) {
  const params = new URLSearchParams({ corpid, corpsecret })
  const response = await $fetch<WecomTokenResponse>(`${baseUrl}/cgi-bin/gettoken?${params.toString()}`, {
    timeout: 10000
  })
  if (response.errcode !== 0 || !response.access_token) {
    throw createError({ statusCode: 502, message: `WeCom gettoken failed: ${response.errcode} ${response.errmsg || ''}`.trim() })
  }
  return response.access_token
}

async function resolveNotificationRuntimeUrl() {
  const settingValue = await getSystemParameter('notification.runtimeApiUrl')
    .catch(() => null)
  return normalizeBaseUrl(settingValue || process.env.HZY_NOTIFICATION_RUNTIME_API_URL || process.env.HZY_NOTIFICATION_RUNTIME_URL || null)
}

async function loadNotificationRuntimeServiceClient() {
  return await queryRow<NotificationRuntimeServiceClientRow>(
    `SELECT scc.id AS credentialId,
            scc.client_id AS clientId,
            sc.client_code AS clientCode,
            sc.client_name AS clientName,
            sc.client_type AS clientType,
            sc.app_code AS appCode
       FROM service_clients sc
       INNER JOIN service_client_credentials scc ON scc.id = sc.current_credential_id
      WHERE sc.client_code = ?
        AND sc.status = 'active'
        AND scc.status = 'active'
      LIMIT 1`,
    [NOTIFICATION_RUNTIME_CLIENT_CODE]
  )
}

async function loadNotificationRuntimeGrantScopes() {
  const rows = await queryRows<ServiceClientGrantRow[]>(
    `SELECT CONCAT(scg.resource_code, ':', scg.action) AS scope
       FROM service_clients sc
       INNER JOIN service_client_grants scg ON scg.service_client_id = sc.id
      WHERE sc.client_code = ?
        AND sc.status = 'active'
        AND scg.status = 'active'
      ORDER BY scg.resource_code, scg.action`,
    [NOTIFICATION_RUNTIME_CLIENT_CODE]
  )
  return rows.map(row => row.scope)
}

async function issueNotificationRuntimeSendToken(event: H3Event) {
  const serviceClient = await loadNotificationRuntimeServiceClient()
  if (!serviceClient) {
    throw createError({
      statusCode: 409,
      message: 'Notification runtime service client is not configured. Generate the install command first.'
    })
  }
  const token = await issueServiceAccessToken({
    event,
    audience: NOTIFICATION_RUNTIME_AUDIENCE,
    scope: NOTIFICATION_RUNTIME_SEND_SCOPE,
    serviceClient
  })
  return token.accessToken
}

function responseMessage(error: unknown) {
  const err = error as {
    message?: string
    statusMessage?: string
    data?: {
      message?: string
      statusMessage?: string
      error?: string
    }
  }
  return stringValue(err?.data?.message || err?.data?.statusMessage || err?.data?.error || err?.statusMessage || err?.message)
}

type ConfigCheckStatus = 'pass' | 'warn' | 'fail'

function configCheckItem(key: string, label: string, status: ConfigCheckStatus, message: string) {
  return { key, label, status, message }
}

function mapIntegration(row: IntegrationRow) {
  return {
    integrationCode: row.integrationCode,
    integrationType: row.integrationType,
    integrationName: row.integrationName,
    category: row.category,
    providerCode: row.providerCode,
    baseUrl: row.baseUrl,
    config: parseConfig(row.configJson),
    connectivityStatus: row.connectivityStatus,
    lastCheckedAt: row.lastCheckedAt,
    lastErrorMessage: row.lastErrorMessage,
    status: row.status,
    currentCredential: row.secretCode
      ? {
          credentialName: row.credentialName || 'primary',
          credentialVersionNo: row.credentialVersionNo,
          versionNo: row.secretVersionNo,
          secretCode: row.secretCode,
          secretRef: row.secretVersionNo ? `${row.secretRef}@v${row.secretVersionNo}` : row.secretRef,
          secretUsageType: row.secretUsageType,
          status: row.credentialStatus || 'unknown'
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

async function loadIntegrationRows(whereSql: string, params: unknown[]) {
  return await queryRows<IntegrationRow[]>(
    `SELECT i.id,
            i.integration_code AS integrationCode,
            i.integration_type AS integrationType,
            i.integration_name AS integrationName,
            i.category,
            i.provider_code AS providerCode,
            i.base_url AS baseUrl,
            i.config_json AS configJson,
            i.connectivity_status AS connectivityStatus,
            i.last_checked_at AS lastCheckedAt,
            i.last_error_message AS lastErrorMessage,
            i.status,
            ic.credential_name AS credentialName,
            ic.version_no AS credentialVersionNo,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.usage_type AS secretUsageType,
            COALESCE(bound_v.version_no, current_v.version_no) AS secretVersionNo,
            ic.status AS credentialStatus,
            i.created_at AS createdAt,
            i.updated_at AS updatedAt
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions bound_v ON bound_v.id = ic.secret_version_id
       LEFT JOIN vault_secret_versions current_v ON current_v.id = vs.current_version_id
      ${whereSql}
      ORDER BY i.category, i.integration_type, i.integration_code`,
    params
  )
}

export async function listIntegrations(query: Record<string, unknown>) {
  const conditions: string[] = []
  const params: unknown[] = []
  const type = stringValue(query.integrationType || query.type)
  const category = stringValue(query.category)
  const status = stringValue(query.status)
  const search = stringValue(query.search || query.keyword)

  if (type) {
    conditions.push('i.integration_type = ?')
    params.push(type)
  }
  if (category) {
    conditions.push('i.category = ?')
    params.push(category)
  }
  if (status) {
    conditions.push('i.status = ?')
    params.push(status)
  }
  if (search) {
    conditions.push('(i.integration_code LIKE ? OR i.integration_name LIKE ? OR i.provider_code LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const rows = await loadIntegrationRows(conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params)
  return { items: rows.map(mapIntegration) }
}

export async function getIntegration(integrationCode: string) {
  const rows = await loadIntegrationRows('WHERE i.integration_code = ?', [integrationCode])
  return rows[0] ? mapIntegration(rows[0]) : null
}

async function loadSecretBindingWith(db: DbExecutor, secretCode: unknown, versionNo?: unknown) {
  const code = assertCode(secretCode, 'secretCode')
  const requestedVersion = Number(versionNo || 0)
  const versionCondition = Number.isFinite(requestedVersion) && requestedVersion > 0
    ? 'AND vsv.version_no = ?'
    : 'AND vsv.id = vs.current_version_id'
  const params: unknown[] = [code]
  if (Number.isFinite(requestedVersion) && requestedVersion > 0) {
    params.push(requestedVersion)
  }

  const row = await db.queryRow<SecretBindingRow>(
    `SELECT vs.id AS secretId,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.usage_type AS usageType,
            vsv.id AS versionId,
            vsv.version_no AS versionNo
       FROM vault_secrets vs
       INNER JOIN vault_secret_versions vsv ON vsv.secret_id = vs.id
      WHERE vs.secret_code = ?
        AND vs.status = 'active'
        AND vsv.status = 'active'
        ${versionCondition}
      LIMIT 1`,
    params
  )
  if (!row) {
    throw createError({ statusCode: 404, message: 'Secret or secret version not found' })
  }
  if (row.usageType !== 'integration') {
    throw createError({ statusCode: 400, message: 'Integration credential must bind usageType=integration secret' })
  }
  return row
}

async function createIntegrationCredentialWith(db: DbExecutor, input: {
  integrationId: number
  credential: IntegrationCredentialInput
  expiresAt?: unknown
}) {
  const secret = await loadSecretBindingWith(db, input.credential.secretCode, input.credential.versionNo)
  const current = await db.queryRow<CredentialRow>(
    `SELECT id,
            version_no AS versionNo,
            rotated_from_id AS rotatedFromId
       FROM integration_credentials
      WHERE integration_id = ?
        AND status = 'active'
      LIMIT 1`,
    [input.integrationId]
  )

  await db.execute<ResultSetHeader>(
    `UPDATE integration_credentials
        SET status = 'retired'
      WHERE integration_id = ?
        AND status = 'active'`,
    [input.integrationId]
  )

  const version = await db.queryRow<RowDataPacket & { versionNo: number }>(
    'SELECT COALESCE(MAX(version_no), 0) + 1 AS versionNo FROM integration_credentials WHERE integration_id = ?',
    [input.integrationId]
  )
  const inserted = await db.execute<ResultSetHeader>(
    `INSERT INTO integration_credentials (
       integration_id,
       credential_name,
       credential_role,
       version_no,
       secret_id,
       secret_version_id,
       rotated_from_id,
       issued_at,
       expires_at,
       status
     ) VALUES (?, 'primary', 'primary', ?, ?, ?, ?, UTC_TIMESTAMP(), ?, 'active')`,
    [
      input.integrationId,
      Number(version?.versionNo || 1),
      secret.secretId,
      secret.versionId,
      current?.id || null,
      toSqlDateTime(input.expiresAt || input.credential.expiresAt)
    ]
  )

  await db.execute<ResultSetHeader>(
    'UPDATE integrations SET current_credential_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
    [inserted.insertId, input.integrationId]
  )

  return {
    credentialId: inserted.insertId,
    secret
  }
}

export async function createIntegration(input: UpsertIntegrationInput) {
  const integrationCode = assertCode(input.integrationCode, 'integrationCode')
  const integrationType = assertCode(input.integrationType, 'integrationType')
  const integrationName = stringValue(input.integrationName) || integrationCode
  const category = stringValue(input.category || 'general')
  const providerCode = nullableString(input.providerCode)
  const baseUrl = nullableString(input.baseUrl)
  const status = assertStatus(input.status)
  const requestedBy = stringValue(input.requestedBy || 'system')

  await withTransaction(async (tx) => {
    const existing = await tx.queryRow<IdRow>(
      'SELECT id FROM integrations WHERE integration_code = ? LIMIT 1',
      [integrationCode]
    )
    if (existing) {
      throw createError({ statusCode: 409, message: 'Integration already exists' })
    }

    const result = await tx.execute<ResultSetHeader>(
      `INSERT INTO integrations (
         integration_code,
         integration_type,
         integration_name,
         category,
         provider_code,
         base_url,
         config_json,
         connectivity_status,
         status,
         created_by,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'unknown', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        integrationCode,
        integrationType,
        integrationName,
        category,
        providerCode,
        baseUrl,
        toSqlJson(input.config),
        status,
        requestedBy
      ]
    )

    if (input.credential?.secretCode) {
      const secret = await loadSecretBindingWith(tx, input.credential.secretCode, input.credential.versionNo)
      const credential = await tx.execute<ResultSetHeader>(
        `INSERT INTO integration_credentials (
           integration_id,
           credential_name,
           credential_role,
           version_no,
           secret_id,
           secret_version_id,
           issued_at,
           expires_at,
           status
         ) VALUES (?, 'primary', 'primary', 1, ?, ?, UTC_TIMESTAMP(), ?, 'active')`,
        [
          result.insertId,
          secret.secretId,
          secret.versionId,
          toSqlDateTime(input.credential.expiresAt)
        ]
      )
      await tx.execute<ResultSetHeader>(
        'UPDATE integrations SET current_credential_id = ? WHERE id = ?',
        [credential.insertId, result.insertId]
      )
    }
  })

  return await getIntegration(integrationCode)
}

export async function updateIntegration(integrationCode: string, input: Partial<UpsertIntegrationInput>) {
  const code = assertCode(integrationCode, 'integrationCode')
  const existing = await queryRow<IntegrationIdRow>('SELECT id, current_credential_id AS currentCredentialId FROM integrations WHERE integration_code = ? LIMIT 1', [code])
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }

  const updates: string[] = []
  const params: unknown[] = []
  if (input.integrationName !== undefined) {
    updates.push('integration_name = ?')
    params.push(stringValue(input.integrationName) || code)
  }
  if (input.baseUrl !== undefined) {
    updates.push('base_url = ?')
    params.push(nullableString(input.baseUrl))
  }
  if (input.config !== undefined) {
    updates.push('config_json = CAST(? AS JSON)')
    params.push(toSqlJson(input.config))
  }
  if (input.status !== undefined) {
    updates.push('status = ?')
    params.push(assertStatus(input.status))
  }
  if (input.providerCode !== undefined) {
    updates.push('provider_code = ?')
    params.push(nullableString(input.providerCode))
  }
  if (input.category !== undefined) {
    updates.push('category = ?')
    params.push(stringValue(input.category || 'general'))
  }

  if (updates.length) {
    await execute<ResultSetHeader>(
      `UPDATE integrations SET ${updates.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [...params, existing.id]
    )
  }

  return await getIntegration(code)
}

export async function rotateIntegrationCredential(integrationCode: string, input: IntegrationCredentialInput) {
  const code = assertCode(integrationCode, 'integrationCode')
  const integration = await queryRow<IntegrationIdRow>(
    'SELECT id, current_credential_id AS currentCredentialId FROM integrations WHERE integration_code = ? LIMIT 1',
    [code]
  )
  if (!integration) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }

  await withTransaction(async (tx) => {
    await createIntegrationCredentialWith(tx, {
      integrationId: integration.id,
      credential: input,
      expiresAt: input.expiresAt
    })
  })

  return await getIntegration(code)
}

export async function checkIntegration(input: {
  event: H3Event
  integrationCode: string
  actor: VaultActor
}) {
  const code = assertCode(input.integrationCode, 'integrationCode')
  const row = await queryRow<IntegrationRow>(
    `SELECT i.id,
            i.integration_code AS integrationCode,
            i.integration_type AS integrationType,
            i.integration_name AS integrationName,
            i.category,
            i.provider_code AS providerCode,
            i.base_url AS baseUrl,
            i.config_json AS configJson,
            i.connectivity_status AS connectivityStatus,
            i.last_checked_at AS lastCheckedAt,
            i.last_error_message AS lastErrorMessage,
            i.status,
            ic.credential_name AS credentialName,
            ic.version_no AS credentialVersionNo,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.usage_type AS secretUsageType,
            COALESCE(bound_v.version_no, current_v.version_no) AS secretVersionNo,
            ic.status AS credentialStatus,
            i.created_at AS createdAt,
            i.updated_at AS updatedAt
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions bound_v ON bound_v.id = ic.secret_version_id
       LEFT JOIN vault_secret_versions current_v ON current_v.id = vs.current_version_id
      WHERE i.integration_code = ?
      LIMIT 1`,
    [code]
  )
  if (!row) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }

  const checkedAt = new Date().toISOString()
  let status: 'healthy' | 'failed' = 'healthy'
  let errorMessage: string | null = null
  const summary: Record<string, unknown> = {
    credentialBound: Boolean(row.secretCode),
    secretVersionNo: row.secretVersionNo,
    secretCode: row.secretCode,
    secretRef: row.secretRef,
    checkMode: 'vault_resolve'
  }
  const config = parseConfig(row.configJson)

  try {
    if (!row.secretCode) {
      throw createError({ statusCode: 409, message: 'Integration has no active credential' })
    }
    const secret = await resolveVaultSecret({
      event: input.event,
      secretRef: row.secretRef || undefined,
      secretCode: row.secretRef ? undefined : row.secretCode,
      versionNo: numberValue(row.secretVersionNo),
      actor: input.actor,
      purpose: `integration_check:${code}`
    })
    if (row.integrationType === 'gitlab') {
      const baseUrl = stringValue(row.baseUrl).replace(/\/+$/, '')
      if (!baseUrl) {
        throw createError({ statusCode: 400, message: 'GitLab baseUrl is required' })
      }
      summary.checkMode = 'gitlab_api_version'
      await $fetch(`${baseUrl}/api/v4/version`, {
        headers: {
          'PRIVATE-TOKEN': secret.value
        },
        timeout: 10000
      })
    } else if (row.integrationType === 'wecom') {
      const baseUrl = normalizeWecomBaseUrl(row.baseUrl)
      const wecomConfig = assertWecomConfig(config)
      summary.agentid = wecomConfig.agentid
      const runtimeUrl = await resolveNotificationRuntimeUrl()
      if (runtimeUrl) {
        summary.checkMode = 'wecom_config_vault_runtime_configured'
        summary.runtimeUrl = runtimeUrl
      } else {
        summary.checkMode = 'wecom_gettoken'
        await requestWecomAccessToken(baseUrl, wecomConfig.corpid, secret.value)
      }
    } else if (row.integrationType === 'oss') {
      const accessKeyId = getConfigValue(config, ['accessKeyId'])
      const bucket = getConfigValue(config, ['bucketName', 'bucket'])
      const endpoint = getConfigValue(config, ['endpoint']) || stringValue(row.baseUrl)
      const region = getConfigValue(config, ['region'])
      if (!accessKeyId || !bucket || !endpoint) {
        throw createError({ statusCode: 400, message: 'OSS accessKeyId, bucketName and endpoint are required' })
      }
      summary.checkMode = 'oss_list'
      const client = new OSS({
        accessKeyId,
        accessKeySecret: secret.value,
        bucket,
        endpoint,
        region: region || undefined
      })
      await (client as unknown as { listV2: (query: Record<string, unknown>) => Promise<unknown> }).listV2({
        'max-keys': 1
      })
    } else if (row.integrationType === 'ai_provider') {
      const baseUrl = stringValue(row.baseUrl).replace(/\/+$/, '')
      const checkPath = getConfigValue(config, ['checkPath', 'modelsPath']) || '/v1/models'
      if (!baseUrl) {
        throw createError({ statusCode: 400, message: 'AI Provider baseUrl is required' })
      }
      summary.checkMode = 'ai_provider_models'
      summary.checkUrl = joinProviderUrl(baseUrl, checkPath)
      await $fetch(summary.checkUrl as string, {
        headers: {
          Authorization: `Bearer ${secret.value}`
        },
        timeout: 10000
      })
    }
  } catch (error) {
    status = 'failed'
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  await execute<ResultSetHeader>(
    `INSERT INTO integration_check_logs (
       integration_id,
       check_type,
       trigger_source,
       status,
       request_summary_json,
       response_summary_json,
       error_message,
       checked_at
     ) VALUES (?, 'connectivity', 'manual', ?, CAST(? AS JSON), CAST(? AS JSON), ?, UTC_TIMESTAMP())`,
    [
      row.id,
      status,
      JSON.stringify({ integrationCode: code }),
      JSON.stringify(summary),
      errorMessage
    ]
  )

  await execute<ResultSetHeader>(
    `UPDATE integrations
        SET connectivity_status = ?,
            last_checked_at = UTC_TIMESTAMP(),
            last_error_message = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [status, errorMessage, row.id]
  )

  return {
    integrationCode: code,
    status,
    checkedAt,
    summary,
    errorMessage
  }
}

export async function sendWecomIntegrationTestMessage(input: {
  event: H3Event
  integrationCode: string
  actor: VaultActor
  touser: unknown
}) {
  const code = assertCode(input.integrationCode, 'integrationCode')
  const touser = stringValue(input.touser)
  if (!touser || touser.length > 256) {
    throw createError({ statusCode: 400, message: 'WeCom account is required' })
  }

  const row = await queryRow<IntegrationRow>(
    `SELECT i.id,
            i.integration_code AS integrationCode,
            i.integration_type AS integrationType,
            i.integration_name AS integrationName,
            i.category,
            i.provider_code AS providerCode,
            i.base_url AS baseUrl,
            i.config_json AS configJson,
            i.connectivity_status AS connectivityStatus,
            i.last_checked_at AS lastCheckedAt,
            i.last_error_message AS lastErrorMessage,
            i.status,
            ic.credential_name AS credentialName,
            ic.version_no AS credentialVersionNo,
            vs.secret_code AS secretCode,
            vs.secret_ref AS secretRef,
            vs.usage_type AS secretUsageType,
            COALESCE(bound_v.version_no, current_v.version_no) AS secretVersionNo,
            ic.status AS credentialStatus,
            i.created_at AS createdAt,
            i.updated_at AS updatedAt
       FROM integrations i
       LEFT JOIN integration_credentials ic ON ic.id = i.current_credential_id
       LEFT JOIN vault_secrets vs ON vs.id = ic.secret_id
       LEFT JOIN vault_secret_versions bound_v ON bound_v.id = ic.secret_version_id
       LEFT JOIN vault_secret_versions current_v ON current_v.id = vs.current_version_id
      WHERE i.integration_code = ?
      LIMIT 1`,
    [code]
  )
  if (!row) {
    throw createError({ statusCode: 404, message: 'Integration not found' })
  }
  if (row.integrationType !== 'wecom') {
    throw createError({ statusCode: 400, message: 'Integration is not a WeCom integration' })
  }
  if (!row.secretCode) {
    throw createError({ statusCode: 409, message: 'Integration has no active credential' })
  }

  const checkedAt = new Date().toISOString()
  const baseUrl = normalizeWecomBaseUrl(row.baseUrl)
  const config = assertWecomConfig(parseConfig(row.configJson))
  const origin = getRequestURL(input.event).origin
  const message = {
    title: '汇智云企业微信通知测试',
    description: [
      '这是一条由汇智云 Console 发送的企业微信测试消息。',
      `集成：${code}`,
      `时间：${checkedAt}`
    ].join('\n'),
    url: origin,
    btntxt: '查看'
  }
  const summary: Record<string, unknown> = {
    integrationCode: code,
    touser,
    agentid: config.agentid,
    secretCode: row.secretCode,
    secretVersionNo: row.secretVersionNo,
    checkMode: 'wecom_message_send'
  }

  try {
    const runtimeUrl = await resolveNotificationRuntimeUrl()
    let response: unknown

    if (runtimeUrl) {
      summary.deliveryMode = 'notification-runtime'
      summary.runtimeUrl = runtimeUrl
      const token = await issueNotificationRuntimeSendToken(input.event)
      response = await $fetch(`${runtimeUrl}/v1/notifications/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 15000,
        body: {
          channel: 'wecom',
          integrationCode: code,
          touser,
          title: message.title,
          description: message.description,
          url: message.url,
          btntxt: message.btntxt
        }
      })
    } else {
      summary.deliveryMode = 'direct_wecom'
      const secret = await resolveVaultSecret({
        event: input.event,
        secretRef: row.secretRef || undefined,
        secretCode: row.secretRef ? undefined : row.secretCode,
        versionNo: numberValue(row.secretVersionNo),
        actor: input.actor,
        purpose: `integration_wecom_test:${code}`
      })
      const token = await requestWecomAccessToken(baseUrl, config.corpid, secret.value)
      const directResponse = await $fetch<WecomSendResponse>(`${baseUrl}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        timeout: 10000,
        body: {
          touser,
          msgtype: 'textcard',
          agentid: config.agentid,
          textcard: message
        }
      })
      response = directResponse
      summary.providerErrcode = directResponse.errcode
      summary.invaliduser = directResponse.invaliduser || undefined
      if (directResponse.errcode !== 0) {
        throw createError({ statusCode: 502, message: `WeCom send failed: ${directResponse.errcode} ${directResponse.errmsg || ''}`.trim() })
      }
    }

    await execute<ResultSetHeader>(
      `INSERT INTO integration_check_logs (
         integration_id,
         check_type,
         trigger_source,
         status,
         request_summary_json,
         response_summary_json,
         error_message,
         checked_at
       ) VALUES (?, 'wecom_test_message', 'manual', 'healthy', CAST(? AS JSON), CAST(? AS JSON), NULL, UTC_TIMESTAMP())`,
      [
        row.id,
        JSON.stringify({ integrationCode: code, touser }),
        JSON.stringify(summary)
      ]
    )
    await execute<ResultSetHeader>(
      `UPDATE integrations
          SET connectivity_status = 'healthy',
              last_checked_at = UTC_TIMESTAMP(),
              last_error_message = NULL,
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [row.id]
    )

    return {
      integrationCode: code,
      touser,
      status: 'sent',
      sentAt: checkedAt,
      deliveryMode: summary.deliveryMode,
      providerResult: response
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await execute<ResultSetHeader>(
      `INSERT INTO integration_check_logs (
         integration_id,
         check_type,
         trigger_source,
         status,
         request_summary_json,
         response_summary_json,
         error_message,
         checked_at
       ) VALUES (?, 'wecom_test_message', 'manual', 'failed', CAST(? AS JSON), CAST(? AS JSON), ?, UTC_TIMESTAMP())`,
      [
        row.id,
        JSON.stringify({ integrationCode: code, touser }),
        JSON.stringify(summary),
        errorMessage
      ]
    )
    await execute<ResultSetHeader>(
      `UPDATE integrations
          SET connectivity_status = 'failed',
              last_checked_at = UTC_TIMESTAMP(),
              last_error_message = ?,
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [errorMessage, row.id]
    )
    throw error
  }
}

export async function checkWecomNotificationRuntimeConfig(input: {
  event: H3Event
  integrationCode?: unknown
  actor: VaultActor
}) {
  const code = assertCode(input.integrationCode || 'wecom.default', 'integrationCode')
  const checkedAt = new Date().toISOString()
  const checks: Array<ReturnType<typeof configCheckItem>> = []

  const runtimeUrl = await resolveNotificationRuntimeUrl()
  if (runtimeUrl) {
    checks.push(configCheckItem('runtimeApiUrl', 'Runtime 地址', 'pass', runtimeUrl))
    try {
      await Promise.all([
        $fetch(`${runtimeUrl}/runtime/health`, { timeout: 10000 }),
        $fetch(`${runtimeUrl}/runtime/capabilities`, { timeout: 10000 })
      ])
      checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'pass', 'health 和 capabilities 均可访问'))
    } catch (error) {
      checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'fail', responseMessage(error) || 'Runtime endpoint is not reachable'))
    }
  } else {
    checks.push(configCheckItem('runtimeApiUrl', 'Runtime 地址', 'fail', 'notification.runtimeApiUrl is not configured'))
    checks.push(configCheckItem('runtimeReachable', 'Runtime 可达性', 'warn', 'Runtime 地址未配置，跳过连通性检测'))
  }

  const rows = await loadIntegrationRows('WHERE i.integration_code = ?', [code])
  const row = rows[0] || null
  if (!row) {
    checks.push(configCheckItem('integration', '企业微信集成', 'fail', `${code} is not configured`))
    return {
      integrationCode: code,
      checkedAt,
      ready: false,
      runtime: {
        apiUrl: runtimeUrl || null
      },
      integration: null,
      serviceClient: null,
      checks
    }
  }

  checks.push(configCheckItem(
    'integration',
    '企业微信集成',
    row.integrationType === 'wecom' ? 'pass' : 'fail',
    row.integrationType === 'wecom' ? `${code} 已配置` : `${code} is ${row.integrationType}, expected wecom`
  ))
  checks.push(configCheckItem(
    'integrationStatus',
    '集成状态',
    row.status === 'active' ? 'pass' : 'fail',
    row.status === 'active' ? 'active' : row.status
  ))

  const config = parseConfig(row.configJson)
  const corpid = getConfigValue(config, ['corpid', 'corpId'])
  const agentid = getConfigValue(config, ['agentid', 'agentId'])
  const agentidNumber = Number(agentid)
  const baseUrl = normalizeWecomBaseUrl(row.baseUrl)

  checks.push(configCheckItem('baseUrl', '企业微信 API Base URL', baseUrl ? 'pass' : 'fail', baseUrl || 'empty'))
  checks.push(configCheckItem('corpid', 'Corp ID', corpid ? 'pass' : 'fail', corpid ? '已填写' : 'missing corpid'))
  checks.push(configCheckItem(
    'agentid',
    'Agent ID',
    agentid && Number.isFinite(agentidNumber) && agentidNumber > 0 ? 'pass' : 'fail',
    agentid ? String(agentid) : 'missing agentid'
  ))

  checks.push(configCheckItem(
    'credential',
    'CorpSecret 凭证',
    row.secretCode ? 'pass' : 'fail',
    row.secretCode ? `${row.secretCode}@v${row.secretVersionNo || 'current'}` : 'missing credential'
  ))
  let secretResolved = false
  if (row.secretCode) {
    try {
      await resolveVaultSecret({
        event: input.event,
        secretRef: row.secretRef || undefined,
        secretCode: row.secretRef ? undefined : row.secretCode,
        versionNo: numberValue(row.secretVersionNo),
        actor: input.actor,
        purpose: 'notification_runtime_wecom_config_check'
      })
      secretResolved = true
      checks.push(configCheckItem('credentialResolve', '凭证解析', 'pass', 'vault secret resolved'))
    } catch (error) {
      checks.push(configCheckItem('credentialResolve', '凭证解析', 'fail', responseMessage(error) || 'vault secret resolve failed'))
    }
  } else {
    checks.push(configCheckItem('credentialResolve', '凭证解析', 'fail', 'missing credential'))
  }

  const serviceClient = await loadNotificationRuntimeServiceClient()
  const grantScopes = serviceClient ? await loadNotificationRuntimeGrantScopes() : []
  const requiredRuntimeGrants = [
    'integration_config:view',
    'credential_vault:resolve'
  ]
  const missingGrants = requiredRuntimeGrants.filter(scope => !grantScopes.includes(scope))
  checks.push(configCheckItem(
    'serviceClient',
    'Runtime Service Client',
    serviceClient ? 'pass' : 'fail',
    serviceClient?.clientId || 'missing notification-runtime service client'
  ))
  checks.push(configCheckItem(
    'serviceGrants',
    'Runtime 读取授权',
    missingGrants.length ? 'fail' : 'pass',
    missingGrants.length ? `missing ${missingGrants.join(', ')}` : requiredRuntimeGrants.join(', ')
  ))

  return {
    integrationCode: code,
    checkedAt,
    ready: !checks.some(item => item.status === 'fail'),
    runtime: {
      apiUrl: runtimeUrl || null
    },
    integration: {
      exists: true,
      status: row.status,
      baseUrl,
      corpidConfigured: Boolean(corpid),
      agentidConfigured: Boolean(agentid),
      credentialBound: Boolean(row.secretCode),
      secretCode: row.secretCode,
      secretVersionNo: row.secretVersionNo,
      secretResolved
    },
    serviceClient: serviceClient
      ? {
          clientId: serviceClient.clientId,
          grants: grantScopes,
          missingGrants
        }
      : null,
    checks
  }
}
