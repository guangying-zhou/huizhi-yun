import { timingSafeEqual } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { withTransaction } from '~~/server/utils/db'
import { dataRuntimeReleaseSettings, resolveDataRuntimeReleaseTarget } from '~~/server/utils/dataRuntimeRelease'
import { exportPubkey } from '~~/server/utils/platformSigning'
import {
  hashTenantRuntimeSecret,
  TENANT_RUNTIME_BINDING_APP_CODES
} from '~~/server/utils/tenantRuntimeEnrollment'

interface RuntimeRow extends RowDataPacket {
  id: number
  runtime_code: string
  tenant_code: string
  environment: string
  desired_version: string
  release_signing_key_id: string
  control_token_hash: string | null
  runtime_endpoint: string | null
}

interface RuntimeBindingRow extends RowDataPacket {
  app_code: string
  deployment_code: string
  status: string
  schema_status: string
  last_error_code: string | null
}

function bearerToken(event: Parameters<typeof getHeader>[0]) {
  const value = String(getHeader(event, 'authorization') || '').trim()
  return /^Bearer /i.test(value) ? value.slice(7).trim() : ''
}

function safeEquals(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const body = await readBody<Record<string, unknown>>(event)
  const runtimeCode = String(body.runtimeCode || '').trim()
  const runtimeVersion = String(body.runtimeVersion || '').trim()
  const releaseSigningKeyId = String(body.releaseSigningKeyId || '').trim()
  const runtimeEndpoint = String(body.runtimeEndpoint || '').trim() || null
  const databaseStatus = String(body.databaseStatus || 'unknown').trim()
  const apps = body.apps && typeof body.apps === 'object' && !Array.isArray(body.apps)
    ? body.apps as Record<string, unknown>
    : {}
  const token = bearerToken(event)
  if (!runtimeCode || !runtimeVersion || !token.startsWith('hzy_ctl_')) {
    throw createError({ statusCode: 401, message: 'valid tenant runtime control credentials are required' })
  }

  const approvedRelease = await dataRuntimeReleaseSettings()
  const platformSigningKey = await exportPubkey()

  const result = await withTransaction(async (tx) => {
    const instance = await tx.queryRow<RuntimeRow>(
      `SELECT id, runtime_code, tenant_code, environment, desired_version,
              release_signing_key_id, control_token_hash, runtime_endpoint
       FROM tenant_runtime_instances
       WHERE runtime_code = ?
       LIMIT 1 FOR UPDATE`,
      [runtimeCode]
    )
    const tokenHash = hashTenantRuntimeSecret(token)
    if (!instance?.control_token_hash || !safeEquals(instance.control_token_hash, tokenHash)) {
      throw createError({ statusCode: 401, message: 'invalid tenant runtime control token' })
    }

    const releaseTarget = resolveDataRuntimeReleaseTarget({
      enrolledDesiredVersion: instance.desired_version,
      enrolledSigningKeyId: instance.release_signing_key_id,
      approvedVersion: approvedRelease.approvedVersion,
      approvedSigningKeyId: approvedRelease.releaseSigningKeyId,
      allowDowngrade: approvedRelease.allowDowngrade
    })
    const versionReady = runtimeVersion === releaseTarget.desiredVersion
    const keyReady = releaseSigningKeyId === instance.release_signing_key_id
    const databaseReady = databaseStatus === 'passed'
    const endpointReady = Boolean(instance.runtime_endpoint || runtimeEndpoint)
    // Release drift is an update signal, not a data-plane outage. Keep an
    // otherwise healthy runtime routable while it rolls toward desired_version.
    const runtimeReady = keyReady && databaseReady && endpointReady
    const status = runtimeReady ? 'ready' : 'unhealthy'
    let errorCode: string | null = null
    if (!keyReady) errorCode = 'release_key_fingerprint_mismatch'
    else if (!databaseReady) errorCode = 'database_connection_failed'
    else if (!endpointReady) errorCode = 'runtime_endpoint_missing'
    else if (!versionReady) errorCode = 'runtime_version_incompatible'

    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_runtime_heartbeats
        (runtime_instance_id, runtime_version, release_signing_key_id, runtime_endpoint,
         apps_json, database_status, heartbeat_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [instance.id, runtimeVersion, releaseSigningKeyId || null, runtimeEndpoint, JSON.stringify(apps), databaseStatus]
    )
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_runtime_instances
       SET status = ?, desired_version = ?, current_version = ?, runtime_endpoint = COALESCE(runtime_endpoint, ?),
           last_heartbeat_at = UTC_TIMESTAMP(), last_error_code = ?,
           last_error_message = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [status, releaseTarget.desiredVersion, runtimeVersion, runtimeEndpoint, errorCode, errorCode, instance.id]
    )

    const bindingAppCodes = [...TENANT_RUNTIME_BINDING_APP_CODES]
    const bindingPlaceholders = bindingAppCodes.map(() => '?').join(', ')
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_runtime_instance_apps
        (runtime_instance_id, deployment_id, app_code, status, schema_status, created_at, updated_at)
       SELECT ?, d.id, d.app_code,
              CASE WHEN d.app_code = 'console' THEN 'schema_ready' WHEN d.app_code = 'enterprise' THEN 'active' ELSE 'pending' END,
              CASE WHEN d.app_code IN ('console', 'enterprise') THEN 'not_applicable' ELSE 'unknown' END,
              UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM deployments d
       INNER JOIN (
         SELECT app_code, MAX(id) AS id
         FROM deployments
         WHERE tenant_code = ? AND environment = ?
           AND status = 'active'
           AND app_code IN (${bindingPlaceholders})
         GROUP BY app_code
       ) active_deployments ON active_deployments.id = d.id
       ON DUPLICATE KEY UPDATE
         deployment_id = VALUES(deployment_id),
         status = CASE
           WHEN VALUES(app_code) IN ('console', 'enterprise') THEN VALUES(status)
           ELSE tenant_runtime_instance_apps.status
         END,
         schema_status = CASE
           WHEN VALUES(app_code) IN ('console', 'enterprise') THEN VALUES(schema_status)
           ELSE tenant_runtime_instance_apps.schema_status
         END,
         last_error_code = CASE
           WHEN VALUES(app_code) IN ('console', 'enterprise') THEN NULL
           ELSE tenant_runtime_instance_apps.last_error_code
         END,
         updated_at = UTC_TIMESTAMP()`,
      [instance.id, instance.tenant_code, instance.environment, ...bindingAppCodes]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_runtime_instance_apps
       SET status = ?, schema_status = ?, last_error_code = ?, updated_at = UTC_TIMESTAMP()
       WHERE runtime_instance_id = ? AND app_code NOT IN ('console', 'enterprise')`,
      [status === 'ready' ? 'runtime_ready' : 'blocked', status === 'ready' ? 'unknown' : 'failed', errorCode, instance.id]
    )

    for (const [appCode, raw] of Object.entries(apps)) {
      if (appCode === 'console' || appCode === 'enterprise') continue
      const app = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
      const enabled = app.enabled === true
      const schemaStatus = String(app.schemaStatus || (enabled ? 'unknown' : 'disabled')).trim()
      const appReady = status === 'ready' && enabled && schemaStatus === 'ok'
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_runtime_instance_apps
         SET status = ?, schema_status = ?, last_error_code = ?, updated_at = UTC_TIMESTAMP()
         WHERE runtime_instance_id = ? AND app_code = ?`,
        [
          appReady ? 'schema_ready' : 'blocked',
          schemaStatus,
          appReady ? null : enabled ? 'schema_migration_required' : 'runtime_app_disabled',
          instance.id,
          appCode
        ]
      )
    }

    const bindings = await tx.queryRows<RuntimeBindingRow[]>(
      `SELECT a.app_code, d.deployment_code,
              a.status, a.schema_status, a.last_error_code
       FROM tenant_runtime_instance_apps a
       INNER JOIN deployments d ON d.id = a.deployment_id
       WHERE a.runtime_instance_id = ?
         AND d.status = 'active'
       ORDER BY a.app_code`,
      [instance.id]
    )

    const bindingReadinessIssues = bindings
      .filter(item => !['schema_ready', 'active'].includes(item.status))
      .map(item => ({
        appCode: item.app_code,
        deploymentCode: item.deployment_code,
        status: item.status,
        schemaStatus: item.schema_status,
        errorCode: item.last_error_code
      }))
    if (bindingReadinessIssues.length > 0) {
      console.warn('[tenant-runtime] active app bindings are unavailable', {
        runtimeCode,
        runtimeStatus: status,
        bindings: bindingReadinessIssues
      })
    }

    return {
      status,
      desiredVersion: releaseTarget.desiredVersion,
      errorCode,
      deploymentBindings: Object.fromEntries(bindings.map(item => [item.app_code, item.deployment_code])),
      platformSigningKey: {
        kid: platformSigningKey.kid,
        alg: platformSigningKey.alg,
        publicKey: platformSigningKey.publicKey
      }
    }
  })

  return {
    data: {
      runtimeCode,
      ...result,
      nextHeartbeatInSeconds: 300
    }
  }
})
