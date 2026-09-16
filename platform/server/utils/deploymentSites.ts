import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { defaultApiBase, defaultAppBasePath, normalizeApiBase, normalizeBasePath, normalizePublicUrl } from '~~/server/utils/appUrls'
import { queryRow } from '~~/server/utils/db'
import { DEFAULT_DEPLOYMENT_ENVIRONMENT, normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

type Executor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface DeploymentSiteRow extends RowDataPacket {
  id: number
  tenant_code: string
  site_code: string
  site_name: string
  public_url: string
  root_app_code: string | null
  environment: string
  status: string
}

export interface DeploymentRouteDefaults {
  siteId: number | null
  basePath: string | null
  apiBase: string
  routeSource: 'default' | 'platform_override' | 'root_app'
}

function normalizeRootAppCode(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function siteCodeForTenant(tenantCode: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `${tenantCode}-main`
    : `${tenantCode}-${environment}`
}

function siteNameForTenant(tenantName: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `${tenantName} · 企业端`
    : `${tenantName} · ${environment} 企业端`
}

export async function findActiveDeploymentSite(
  tenantCode: string,
  executor?: Pick<Executor, 'queryRow'> | null,
  environment?: unknown
) {
  const db = executor || { queryRow }
  const normalizedEnvironment = normalizeDeploymentEnvironment(environment)
  return db.queryRow<DeploymentSiteRow>(
    `SELECT id, tenant_code, site_code, site_name, public_url, root_app_code, environment, status
     FROM deployment_sites
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     ORDER BY id DESC
     LIMIT 1`,
    [tenantCode, normalizedEnvironment]
  )
}

export async function ensureDeploymentSite(input: {
  executor: Executor
  tenantCode: string
  tenantName: string
  publicUrl: string
  rootAppCode?: string | null
  environment?: unknown
  createdByAccountId?: number | null
}) {
  const publicUrl = normalizePublicUrl(input.publicUrl)
  if (!publicUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'deploymentPublicUrl must be an absolute http(s) URL'
    })
  }

  const rootAppCode = normalizeRootAppCode(input.rootAppCode)
  const environment = normalizeDeploymentEnvironment(input.environment)
  const existing = await input.executor.queryRow<DeploymentSiteRow>(
    `SELECT id, tenant_code, site_code, site_name, public_url, root_app_code, environment, status
     FROM deployment_sites
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     LIMIT 1
     FOR UPDATE`,
    [input.tenantCode, environment]
  )

  if (existing) {
    await input.executor.execute<ResultSetHeader>(
      `UPDATE deployment_sites
       SET public_url = ?, root_app_code = ?, updated_by_account_id = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [publicUrl, rootAppCode, input.createdByAccountId || null, existing.id]
    )

    return {
      ...existing,
      public_url: publicUrl,
      root_app_code: rootAppCode,
      environment
    }
  }

  const inserted = await input.executor.execute<ResultSetHeader>(
    `INSERT INTO deployment_sites
      (tenant_code, site_code, site_name, public_url, root_app_code, environment, status,
       created_by_account_id, updated_by_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      input.tenantCode,
      siteCodeForTenant(input.tenantCode, environment),
      siteNameForTenant(input.tenantName, environment),
      publicUrl,
      rootAppCode,
      environment,
      input.createdByAccountId || null,
      input.createdByAccountId || null
    ]
  )

  return {
    id: inserted.insertId,
    tenant_code: input.tenantCode,
    site_code: siteCodeForTenant(input.tenantCode, environment),
    site_name: siteNameForTenant(input.tenantName, environment),
    public_url: publicUrl,
    root_app_code: rootAppCode,
    environment,
    status: 'active'
  } as DeploymentSiteRow
}

export function buildDeploymentRouteDefaults(input: {
  appCode: string
  site?: DeploymentSiteRow | null
  basePath?: string | null
  apiBase?: string | null
}): DeploymentRouteDefaults {
  const explicitBasePath = normalizeBasePath(input.basePath)
  const rootAppCode = String(input.site?.root_app_code || '').trim()
  const isRootApp = Boolean(rootAppCode && rootAppCode === input.appCode)
  const basePath = explicitBasePath || (isRootApp ? '/' : defaultAppBasePath(input.appCode))
  const routeSource = isRootApp && basePath === '/'
    ? 'root_app'
    : explicitBasePath
      ? 'platform_override'
      : 'default'

  return {
    siteId: input.site?.id || null,
    basePath,
    apiBase: normalizeApiBase(input.apiBase, input.appCode) || defaultApiBase(input.appCode),
    routeSource
  }
}
