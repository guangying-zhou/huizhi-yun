import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'
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
const ALLOWED_VERSION_STATUSES = new Set(['unknown', 'current', 'drifted', 'incompatible'])

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is invalid' })
  }
  return id
}

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be one of: ${Array.from(allowed).join(', ')}` })
  }
  return value
}

async function loadDeployment(id: number) {
  return queryRow<DeploymentRow>(
    `SELECT id, tenant_code, app_code, subscription_id, deployment_code, deployment_name, deployment_mode,
            site_id, base_path, api_base, route_source, runtime_endpoint,
            environment, region, status, license_status, connectivity_status, version_status,
            reported_app_version, reported_manifest_version, reported_manifest_hash, reported_sdk_version,
            last_reported_at, last_heartbeat_at, created_at, updated_at
     FROM deployments
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const isTenantAdminRequest = event.context.platformAccessScope === 'tenant-admin'
  const existing = await loadDeployment(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `deployment not found: id=${id}` })
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []
  const nextEnvironment = body.environment !== undefined
    ? normalizeDeploymentEnvironment(body.environment)
    : existing.environment

  if (body.deploymentName !== undefined) {
    const deploymentName = String(body.deploymentName || '').trim()
    if (!deploymentName) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'deploymentName is required' })
    }
    updates.push('deployment_name = ?')
    params.push(deploymentName)
  }

  if (body.deploymentMode !== undefined) {
    updates.push('deployment_mode = ?')
    params.push(requireAllowed(String(body.deploymentMode), 'deploymentMode', ALLOWED_DEPLOYMENT_MODES))
  }

  if (body.environment !== undefined) {
    updates.push('environment = ?')
    params.push(nextEnvironment)
  }

  if (body.region !== undefined) {
    updates.push('region = ?')
    params.push(normalizeNullableString(body.region))
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (body.licenseStatus !== undefined) {
    updates.push('license_status = ?')
    params.push(requireAllowed(String(body.licenseStatus), 'licenseStatus', ALLOWED_LICENSE_STATUSES))
  }

  if (body.connectivityStatus !== undefined) {
    updates.push('connectivity_status = ?')
    params.push(requireAllowed(String(body.connectivityStatus), 'connectivityStatus', ALLOWED_CONNECTIVITY_STATUSES))
  }

  if (body.versionStatus !== undefined) {
    updates.push('version_status = ?')
    params.push(requireAllowed(String(body.versionStatus), 'versionStatus', ALLOWED_VERSION_STATUSES))
  }

  if (body.lastHeartbeatAt !== undefined) {
    updates.push('last_heartbeat_at = ?')
    params.push(normalizeNullableString(body.lastHeartbeatAt))
  }

  if (body.lastReportedAt !== undefined) {
    updates.push('last_reported_at = ?')
    params.push(normalizeNullableString(body.lastReportedAt))
  }

  if (body.runtimeEndpoint !== undefined) {
    if (!isTenantAdminRequest) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'runtimeEndpoint is tenant-managed'
      })
    }
    updates.push('runtime_endpoint = ?')
    params.push(normalizeNullableString(body.runtimeEndpoint))
  }

  if (body.reportedAppVersion !== undefined) {
    updates.push('reported_app_version = ?')
    params.push(normalizeNullableString(body.reportedAppVersion))
  }

  if (body.reportedManifestVersion !== undefined) {
    updates.push('reported_manifest_version = ?')
    params.push(normalizeNullableString(body.reportedManifestVersion))
  }

  if (body.reportedManifestHash !== undefined) {
    updates.push('reported_manifest_hash = ?')
    params.push(normalizeNullableString(body.reportedManifestHash))
  }

  if (body.reportedSdkVersion !== undefined) {
    updates.push('reported_sdk_version = ?')
    params.push(normalizeNullableString(body.reportedSdkVersion))
  }

  if (body.basePath !== undefined || body.environment !== undefined) {
    const site = await findActiveDeploymentSite(existing.tenant_code, null, nextEnvironment)
    const route = buildDeploymentRouteDefaults({
      appCode: existing.app_code,
      site,
      basePath: normalizeNullableString(body.basePath),
      apiBase: body.apiBase !== undefined ? normalizeNullableString(body.apiBase) : existing.api_base
    })

    updates.push('site_id = ?', 'base_path = ?', 'api_base = ?', 'route_source = ?')
    params.push(route.siteId ?? (body.environment === undefined ? existing.site_id : null), route.basePath, route.apiBase, route.routeSource)
  } else if (body.apiBase !== undefined) {
    const route = buildDeploymentRouteDefaults({
      appCode: existing.app_code,
      site: null,
      basePath: existing.base_path,
      apiBase: normalizeNullableString(body.apiBase)
    })

    updates.push('api_base = ?')
    params.push(route.apiBase)
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'no updatable fields provided' })
  }

  await execute<ResultSetHeader>(
    `UPDATE deployments
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    [...params, id]
  )

  const deployment = await loadDeployment(id)
  if (!deployment) {
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load updated deployment' })
  }

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
