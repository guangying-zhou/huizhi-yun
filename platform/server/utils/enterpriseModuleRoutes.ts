import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { enterpriseCompositionModules } from './enterpriseComposition.ts'
import { parseManifestResources } from './appManifestResources.ts'
import { buildAppHomeUrl, defaultAppBasePath, deriveLogoutUrl, deriveOidcCallbackUrl } from './appUrls.ts'

type Query = <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
type Row = RowDataPacket & Record<string, unknown>
export interface EnterpriseHostModuleRoute {
  appCode: string
  hostAppCode: 'enterprise'
  deploymentId: number
  deploymentCode: string
  manifestHash: string
  moduleManifestHash: string
  basePath: string
  apiBase: string
  homeUrl: string
}
function parse(value: unknown): Record<string, unknown> {
  return (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** A registered catalog is not proof of a running Host. Reported identity must match that catalog.
 * No synthetic logical deployments or grants are created; only two retained business prefixes map. */
export async function loadEnterpriseHostModuleRoutes(query: Query, tenantCode: string, environment: string): Promise<EnterpriseHostModuleRoute[]> {
  const host = await query<Row>(`SELECT d.id, d.deployment_code, d.reported_manifest_hash, m.manifest_hash, m.manifest_json, ds.public_url
    FROM deployments d
    INNER JOIN deployment_sites ds ON ds.id=d.site_id AND ds.tenant_code=d.tenant_code AND ds.environment=d.environment AND ds.status='active'
    INNER JOIN platform_applications a ON a.app_code=d.app_code AND a.status='active'
    INNER JOIN platform_app_manifests m ON m.id=a.latest_manifest_id AND m.app_code=a.app_code AND m.status='active'
    WHERE d.tenant_code=? AND d.environment=? AND d.app_code='enterprise' AND d.status='active'
      AND d.license_status NOT IN ('revoked','suspended','disabled','expired') AND d.base_path='/' AND ds.root_app_code='enterprise'
    ORDER BY d.id DESC LIMIT 1`, [tenantCode, environment])
  if (!host || !host.reported_manifest_hash || host.reported_manifest_hash !== host.manifest_hash) return []
  let modules
  try {
    modules = enterpriseCompositionModules('enterprise', parse(host.manifest_json))
  } catch {
    return []
  }
  const routes: EnterpriseHostModuleRoute[] = []
  for (const module of modules) {
    if (!['aims', 'assets'].includes(module.appCode)) continue
    const logical = await query<Row>(`SELECT m.id,m.manifest_json FROM platform_applications a
      INNER JOIN platform_app_manifests m ON m.id=a.latest_manifest_id AND m.app_code=a.app_code AND m.status='active'
      WHERE a.app_code=? AND a.status='active'`, [module.appCode])
    if (!logical || canonical(parse(logical.manifest_json)) !== canonical(module.manifest)) return []
    for (const resource of parseManifestResources(module.manifest)) {
      for (const action of resource.actions) {
        const registered = await query<Row>(`SELECT id FROM platform_app_manifest_resource_actions
          WHERE manifest_id=? AND app_code=? AND resource_code=? AND action=? AND status='active' LIMIT 1`, [logical.id, module.appCode, resource.resourceCode, action.action])
        if (!registered) return []
      }
    }
    const basePath = defaultAppBasePath(module.appCode)
    const homeUrl = buildAppHomeUrl(host.public_url, basePath)
    if (!homeUrl) return []
    const url = new URL(homeUrl)
    if (url.username || url.password) return []
    routes.push({ appCode: module.appCode, hostAppCode: 'enterprise', deploymentId: Number(host.id), deploymentCode: String(host.deployment_code), manifestHash: String(host.manifest_hash), moduleManifestHash: hash(module.manifest), basePath, apiBase: `/${module.appCode}/api/v1`, homeUrl })
  }
  return routes.sort((a, b) => a.appCode.localeCompare(b.appCode))
}

export function applyEnterpriseHostModuleRoutes<T extends { appCode: string }>(applications: T[], routes: EnterpriseHostModuleRoute[]) {
  return applications.map((app) => {
    const route = routes.find(item => item.appCode === app.appCode)
    return route
      ? { ...app, basePath: route.basePath, apiBase: route.apiBase, homeUrl: route.homeUrl,
          routeSource: 'enterprise-composition', callbackUrl: deriveOidcCallbackUrl(route.homeUrl), logoutUrl: deriveLogoutUrl(route.homeUrl) }
      : app
  })
}
export function enterpriseHostRoutesMatch(payload: Record<string, unknown>, routes: EnterpriseHostModuleRoute[]) {
  return canonical(payload.enterpriseHostRoutes || []) === canonical(routes)
}
