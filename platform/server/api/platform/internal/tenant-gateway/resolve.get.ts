import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import {
  consoleLoginSettings,
  dataRuntimeSettings,
  hostFromUrl,
  normalizeDataRuntimeEndpoint,
  parseTenantSettings
} from '~~/server/utils/tenantDeploymentSettings'

interface SiteRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  public_url: string
  root_app_code: string | null
  environment: string
  primary_domain: string | null
  settings_json: unknown
}

interface DeploymentRow extends RowDataPacket {
  app_code: string
  deployment_code: string
  base_path: string | null
  api_base: string | null
  runtime_endpoint: string | null
}

interface RuntimeInstanceRow extends RowDataPacket {
  id: number
  runtime_code: string
  status: string
  runtime_endpoint: string | null
  current_version: string | null
  desired_version: string
}

interface RuntimeAppRow extends RowDataPacket {
  app_code: string
  status: string
}

function isMissingTenantRuntimeTable(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE'
}

async function loadRuntimeInstance(tenantCode: string, environment: string) {
  try {
    return await queryRow<RuntimeInstanceRow>(
      `SELECT id, runtime_code, status, runtime_endpoint, current_version, desired_version
       FROM tenant_runtime_instances
       WHERE tenant_code = ? AND environment = ?
       LIMIT 1`,
      [tenantCode, environment]
    )
  } catch (error) {
    if (isMissingTenantRuntimeTable(error)) return null
    throw error
  }
}

function normalizeHost(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
}

function isLoopbackHost(hostname: string) {
  const host = hostname.trim().replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost'
    || host === '0.0.0.0'
    || host === '::1'
    || /^127(?:\.\d{1,3}){0,3}$/.test(host)
}

function normalizeDeploymentDataRuntimeEndpoint(value: unknown) {
  try {
    const endpoint = normalizeDataRuntimeEndpoint(value)
    if (!endpoint) {
      return null
    }

    const hostname = new URL(endpoint).hostname
    return isLoopbackHost(hostname) ? null : endpoint
  } catch {
    return null
  }
}

async function findSiteByHost(host: string) {
  const rows = await queryRows<SiteRow[]>(
    `SELECT ds.id, ds.tenant_code, t.tenant_name, ds.public_url, ds.root_app_code,
            ds.environment, t.primary_domain, t.settings_json
     FROM deployment_sites ds
     INNER JOIN tenants t ON t.tenant_code = ds.tenant_code
     WHERE ds.status = 'active'
     ORDER BY ds.id DESC
     LIMIT 1000`
  )

  const exactSite = rows.find(row => hostFromUrl(row.public_url) === host)
  if (exactSite) {
    return exactSite
  }

  const primaryDomainSites = rows.filter(row => hostFromUrl(row.primary_domain) === host)
  return primaryDomainSites.find(row => row.environment === 'prod') || primaryDomainSites[0] || null
}

export default defineEventHandler(async (event) => {
  const host = normalizeHost(requireString(getQuery(event).host, 'host'))
  const site = await findSiteByHost(host)

  if (!site) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant site not found for host=${host}`
    })
  }

  const deployments = await queryRows<DeploymentRow[]>(
    `SELECT app_code, deployment_code, base_path, api_base, runtime_endpoint
     FROM deployments
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     ORDER BY app_code ASC`,
    [site.tenant_code, site.environment]
  )

  const runtimeInstance = await loadRuntimeInstance(site.tenant_code, site.environment)
  const runtimeApps = runtimeInstance
    ? await queryRows<RuntimeAppRow[]>(
        `SELECT app_code, status
         FROM tenant_runtime_instance_apps
         WHERE runtime_instance_id = ?`,
        [runtimeInstance.id]
      )
    : []
  const runtimeAppStatus = new Map(runtimeApps.map(item => [item.app_code, item.status]))
  const runtimeReady = !runtimeInstance || runtimeInstance.status === 'ready'
  const allRuntimeAppsReady = !runtimeInstance
    || (runtimeApps.length > 0 && runtimeApps.every(item => ['schema_ready', 'active'].includes(item.status)))

  const apps: Record<string, unknown> = {}
  let defaultDeploymentCode = ''
  const settings = parseTenantSettings(site.settings_json)
  const defaultRuntimeEndpoint = runtimeReady && allRuntimeAppsReady
    ? normalizeDeploymentDataRuntimeEndpoint(runtimeInstance?.runtime_endpoint || dataRuntimeSettings(settings, site.environment).defaultEndpoint)
    : null
  const login = consoleLoginSettings(settings, site.environment)

  for (const deployment of deployments) {
    const bindingReady = !runtimeInstance || ['schema_ready', 'active'].includes(runtimeAppStatus.get(deployment.app_code) || '')
    const runtimeEndpoint = runtimeReady && bindingReady
      ? normalizeDeploymentDataRuntimeEndpoint(deployment.runtime_endpoint || runtimeInstance?.runtime_endpoint)
      : null

    if (
      !defaultDeploymentCode
      || (site.root_app_code && deployment.app_code === site.root_app_code)
      || (!site.root_app_code && deployment.app_code === 'console')
    ) {
      defaultDeploymentCode = deployment.deployment_code
    }

    apps[deployment.app_code] = {
      deploymentCode: deployment.deployment_code,
      basePath: deployment.base_path,
      apiBase: deployment.api_base,
      ...(runtimeEndpoint ? { dataRuntime: { endpoint: runtimeEndpoint } } : {})
    }
  }

  return ok({
    host,
    tenantCode: site.tenant_code,
    tenantName: site.tenant_name,
    environment: site.environment,
    deploymentCode: defaultDeploymentCode,
    publicUrl: site.public_url,
    rootAppCode: site.root_app_code,
    dataRuntime: {
      ...(defaultRuntimeEndpoint ? { endpoint: defaultRuntimeEndpoint } : {}),
      audience: 'data-runtime',
      ...(runtimeInstance
        ? {
            runtimeCode: runtimeInstance.runtime_code,
            status: runtimeInstance.status,
            currentVersion: runtimeInstance.current_version,
            desiredVersion: runtimeInstance.desired_version
          }
        : {})
    },
    login,
    apps
  })
})
