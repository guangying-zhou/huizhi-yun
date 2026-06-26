import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { buildDeploymentRouteDefaults, findActiveDeploymentSite } from '~~/server/utils/deploymentSites'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface DeploymentRow extends RowDataPacket {
  id: number
  tenant_code: string
  app_code: string
  subscription_id: number
  site_id: number | null
  base_path: string | null
  api_base: string | null
  route_source: string | null
  runtime_endpoint: string | null
  deployment_code: string
  deployment_name: string
  deployment_mode: string
  environment: string
  region: string | null
  status: string
  license_status: string
  connectivity_status: string
  version_status: string
  reported_app_version: string | null
  reported_manifest_version: string | null
  reported_manifest_hash: string | null
  reported_sdk_version: string | null
  last_reported_at: string | null
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

const ALLOWED_DEPLOYMENT_MODES = new Set(['managed-control-plane', 'self-hosted-enterprise', 'customer-hosted'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])
const ALLOWED_LICENSE_STATUSES = new Set(['pending', 'active', 'grace', 'expired', 'suspended', 'disabled'])
const ALLOWED_CONNECTIVITY_STATUSES = new Set(['pending', 'running', 'passed', 'failed'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be one of: ${Array.from(allowed).join(', ')}` })
  return value
}

async function loadDeployment(id: number) {
  return queryRow<DeploymentRow>(
    `SELECT id, tenant_code, app_code, subscription_id, deployment_code, deployment_name, deployment_mode, environment, region,
            site_id, base_path, api_base, route_source, runtime_endpoint,
            status, license_status, connectivity_status, version_status,
            reported_app_version, reported_manifest_version, reported_manifest_hash, reported_sdk_version,
            last_reported_at, last_heartbeat_at, created_at, updated_at
     FROM deployments
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const isTenantAdminRequest = event.context.platformAccessScope === 'tenant-admin'
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const appCode = requireString(body.appCode, 'appCode')
  const deploymentCode = requireString(body.deploymentCode, 'deploymentCode')
  const deploymentName = requireString(body.deploymentName, 'deploymentName')
  const deploymentMode = requireAllowed(normalizeNullableString(body.deploymentMode) || 'managed-control-plane', 'deploymentMode', ALLOWED_DEPLOYMENT_MODES)
  const environment = normalizeDeploymentEnvironment(body.environment)
  const region = normalizeNullableString(body.region)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const licenseStatus = requireAllowed(normalizeNullableString(body.licenseStatus) || 'pending', 'licenseStatus', ALLOWED_LICENSE_STATUSES)
  const connectivityStatus = requireAllowed(normalizeNullableString(body.connectivityStatus) || 'pending', 'connectivityStatus', ALLOWED_CONNECTIVITY_STATUSES)
  const runtimeEndpoint = isTenantAdminRequest ? normalizeNullableString(body.runtimeEndpoint) : null
  const subscriptionIdInput = body.subscriptionId === undefined ? null : Number(body.subscriptionId)

  const tenant = await queryRow<RowDataPacket>('SELECT id FROM tenants WHERE tenant_code = ? LIMIT 1', [tenantCode])
  if (!tenant) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `tenant not found: tenantCode=${tenantCode}` })

  const application = await queryRow<RowDataPacket>(
    `SELECT id
     FROM platform_applications
     WHERE app_code = ?
     LIMIT 1`,
    [appCode]
  )
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: appCode=${appCode}` })

  const subscription = await queryRow<RowDataPacket & { id: number, status: string }>(
    `SELECT id, status
     FROM subscriptions
     WHERE tenant_code = ?
       AND app_code = ?
       ${subscriptionIdInput && Number.isFinite(subscriptionIdInput) ? 'AND id = ?' : ''}
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC
     LIMIT 1`,
    subscriptionIdInput && Number.isFinite(subscriptionIdInput)
      ? [tenantCode, appCode, subscriptionIdInput]
      : [tenantCode, appCode]
  )

  if (!subscription || subscription.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `active subscription not found: tenantCode=${tenantCode}, appCode=${appCode}`
    })
  }

  const site = await findActiveDeploymentSite(tenantCode, null, environment)
  if (status === 'active' && !site) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `active deployment site not configured: tenantCode=${tenantCode}, environment=${environment}`
    })
  }

  const route = buildDeploymentRouteDefaults({
    appCode,
    site,
    basePath: normalizeNullableString(body.basePath),
    apiBase: normalizeNullableString(body.apiBase)
  })

  const deploymentCodeUsed = await queryRow<RowDataPacket & { app_code: string }>(
    `SELECT id, app_code
     FROM deployments
     WHERE deployment_code = ?
     LIMIT 1`,
    [deploymentCode]
  )

  if (deploymentCodeUsed) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: `deploymentCode already exists: deploymentCode=${deploymentCode}` })
  }

  const existingActive = await queryRow<RowDataPacket>(
    `SELECT id
     FROM deployments
     WHERE tenant_code = ?
       AND app_code = ?
       AND environment = ?
       AND status = 'active'
     LIMIT 1`,
    [tenantCode, appCode, environment]
  )

  if (existingActive && status === 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `active deployment already exists for tenantCode=${tenantCode}, appCode=${appCode}, environment=${environment}`
    })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO deployments
      (tenant_code, app_code, subscription_id, deployment_code, deployment_name, deployment_mode,
       environment, region, status, license_status, connectivity_status,
       site_id, base_path, api_base, route_source, runtime_endpoint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      tenantCode,
      appCode,
      subscription.id,
      deploymentCode,
      deploymentName,
      deploymentMode,
      environment,
      region,
      status,
      licenseStatus,
      connectivityStatus,
      route.siteId,
      route.basePath,
      route.apiBase,
      route.routeSource,
      runtimeEndpoint
    ]
  )

  const deployment = await loadDeployment(result.insertId)
  if (!deployment) throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load created deployment' })

  return ok({
    id: deployment.id,
    tenantCode: deployment.tenant_code,
    appCode: deployment.app_code,
    subscriptionId: deployment.subscription_id,
    siteId: deployment.site_id,
    basePath: deployment.base_path,
    apiBase: deployment.api_base,
    routeSource: deployment.route_source,
    runtimeEndpoint: deployment.runtime_endpoint,
    deploymentCode: deployment.deployment_code,
    deploymentName: deployment.deployment_name,
    deploymentMode: deployment.deployment_mode,
    environment: deployment.environment,
    region: deployment.region,
    status: deployment.status,
    licenseStatus: deployment.license_status,
    connectivityStatus: deployment.connectivity_status,
    versionStatus: deployment.version_status,
    reportedAppVersion: deployment.reported_app_version,
    reportedManifestVersion: deployment.reported_manifest_version,
    reportedManifestHash: deployment.reported_manifest_hash,
    reportedSdkVersion: deployment.reported_sdk_version,
    lastReportedAt: deployment.last_reported_at,
    lastHeartbeatAt: deployment.last_heartbeat_at,
    createdAt: deployment.created_at,
    updatedAt: deployment.updated_at
  })
})
