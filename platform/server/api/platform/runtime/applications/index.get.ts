import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { buildAppHomeUrl, defaultApiBase, defaultAppBasePath, deriveLogoutUrl, resolveOidcCallbackUrl } from '~~/server/utils/appUrls'
import { queryRows } from '~~/server/utils/db'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ApplicationRow extends RowDataPacket {
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  callback_url: string | null
  logout_url: string | null
  public_url: string | null
  base_path: string | null
  api_base: string | null
  route_source: string | null
  app_type: string
  runtime_mode: string
  auth_mode: string
  bundle_enabled: number
  sort_order: number
  status: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const runtimeDeployment = (event.context.platformRuntime as { deployment?: { environment?: string } | null } | undefined)?.deployment
    || (event.context.deployment as { environment?: string } | undefined)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const environment = normalizeDeploymentEnvironment(query.environment || runtimeDeployment?.environment)
  const status = normalizeNullableString(query.status) || 'active'

  const items = await queryRows<ApplicationRow[]>(
    `SELECT pa.app_code, pa.app_name, pa.description, pa.icon,
            pa.home_url,
            pa.callback_url,
            pa.logout_url,
            COALESCE(ds.public_url, tenant_site.public_url) AS public_url,
            d.base_path,
            d.api_base,
            d.route_source,
            pa.app_type,
            pa.runtime_mode, pa.auth_mode, pa.bundle_enabled, pa.sort_order, pa.status
     FROM subscriptions s
     INNER JOIN platform_applications pa ON pa.app_code = s.app_code
     LEFT JOIN deployments d
       ON d.id = (
         SELECT d2.id
         FROM deployments d2
         WHERE d2.tenant_code = s.tenant_code
           AND d2.app_code = s.app_code
           AND d2.environment = ?
           AND d2.status = 'active'
         ORDER BY CASE WHEN d2.status = 'active' THEN 0 ELSE 1 END, d2.updated_at DESC, d2.id DESC
         LIMIT 1
       )
     LEFT JOIN deployment_sites ds
       ON ds.id = d.site_id
      AND ds.status = 'active'
     LEFT JOIN deployment_sites tenant_site
       ON tenant_site.id = (
         SELECT ds2.id
         FROM deployment_sites ds2
         WHERE ds2.tenant_code = s.tenant_code
           AND ds2.environment = ?
           AND ds2.status = 'active'
         ORDER BY ds2.id DESC
         LIMIT 1
       )
     WHERE s.tenant_code = ?
       AND s.status = 'active'
       AND pa.status = ?
     ORDER BY pa.sort_order ASC, pa.app_code ASC`,
    [environment, environment, tenantCode, status]
  )

  return ok({
    items: items.map(item => ({
      tenantCode,
      appCode: item.app_code,
      appName: item.app_name,
      description: item.description,
      icon: item.icon,
      basePath: item.base_path || defaultAppBasePath(item.app_code),
      apiBase: item.api_base || defaultApiBase(item.app_code),
      routeSource: item.route_source || 'default',
      homeUrl: buildAppHomeUrl(item.public_url, item.base_path || defaultAppBasePath(item.app_code)) || item.home_url,
      callbackUrl: resolveOidcCallbackUrl(item.callback_url, buildAppHomeUrl(item.public_url, item.base_path || defaultAppBasePath(item.app_code)) || item.home_url),
      logoutUrl: item.logout_url || deriveLogoutUrl(buildAppHomeUrl(item.public_url, item.base_path || defaultAppBasePath(item.app_code)) || item.home_url),
      appType: item.app_type,
      runtimeMode: item.runtime_mode,
      authMode: item.auth_mode,
      bundleEnabled: Boolean(item.bundle_enabled),
      sortOrder: Number(item.sort_order || 0),
      status: item.status
    }))
  })
})
