import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
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

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const status = normalizeNullableString(query.status)
  const environment = normalizeNullableString(query.environment)
  const keyword = normalizeNullableString(query.keyword)
  const appCode = normalizeNullableString(query.appCode)
  const { page, pageSize, offset } = parsePagination(query)

  const where = ['tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (status) {
    where.push('status = ?')
    params.push(status)
  }

  if (environment) {
    where.push('environment = ?')
    params.push(normalizeDeploymentEnvironment(environment))
  }

  if (appCode) {
    where.push('app_code = ?')
    params.push(appCode)
  }

  if (keyword) {
    where.push('(deployment_code LIKE ? OR deployment_name LIKE ? OR app_code LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<DeploymentRow[]>(
    `SELECT id, tenant_code, app_code, subscription_id, deployment_code, deployment_name, deployment_mode,
            site_id, base_path, api_base, route_source, runtime_endpoint,
            environment, region, status, license_status, connectivity_status, version_status,
            reported_app_version, reported_manifest_version, reported_manifest_hash, reported_sdk_version,
            last_reported_at, last_heartbeat_at, created_at, updated_at
     FROM deployments
     ${whereSql}
     ORDER BY deployment_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM deployments
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      appCode: item.app_code,
      subscriptionId: item.subscription_id,
      siteId: item.site_id,
      basePath: item.base_path,
      apiBase: item.api_base,
      routeSource: item.route_source,
      runtimeEndpoint: item.runtime_endpoint,
      deploymentCode: item.deployment_code,
      deploymentName: item.deployment_name,
      deploymentMode: item.deployment_mode,
      environment: item.environment,
      region: item.region,
      status: item.status,
      licenseStatus: item.license_status,
      connectivityStatus: item.connectivity_status,
      versionStatus: item.version_status,
      reportedAppVersion: item.reported_app_version,
      reportedManifestVersion: item.reported_manifest_version,
      reportedManifestHash: item.reported_manifest_hash,
      reportedSdkVersion: item.reported_sdk_version,
      lastReportedAt: item.last_reported_at,
      lastHeartbeatAt: item.last_heartbeat_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
