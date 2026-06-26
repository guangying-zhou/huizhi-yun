import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
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

interface BootstrapSecretRow extends RowDataPacket {
  secret_value: string
}

const DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE = 'data-runtime.static_token'

function normalizeHost(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
}

function isMissingTableError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE'
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

async function loadDataRuntimeStaticToken(tenantCode: string, environment: string) {
  try {
    const row = await queryRow<BootstrapSecretRow>(
      `SELECT s.secret_value
       FROM deployment_bootstrap_secrets s
       INNER JOIN deployments d ON d.id = s.deployment_id
       WHERE s.tenant_code = ?
         AND d.environment = ?
         AND s.secret_code = ?
         AND s.status = 'active'
       ORDER BY s.id DESC
       LIMIT 1`,
      [tenantCode, environment, DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE]
    )

    return normalizeNullableString(row?.secret_value)
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }
    throw error
  }
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

  const apps: Record<string, unknown> = {}
  let defaultDeploymentCode = ''
  const settings = parseTenantSettings(site.settings_json)
  const defaultRuntimeEndpoint = dataRuntimeSettings(settings, site.environment).defaultEndpoint
  const login = consoleLoginSettings(settings, site.environment)

  for (const deployment of deployments) {
    const runtimeEndpoint = normalizeDeploymentDataRuntimeEndpoint(deployment.runtime_endpoint)

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

  const staticToken = await loadDataRuntimeStaticToken(site.tenant_code, site.environment)

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
      ...(staticToken ? { staticToken } : {})
    },
    login,
    apps
  })
})
