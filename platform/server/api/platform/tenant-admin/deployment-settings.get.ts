import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import {
  dataRuntimeSettings,
  consoleLoginSettings,
  hostFromUrl,
  normalizeDeploymentEnvironment,
  parseTenantSettings,
  platformEnvironmentSettings,
  subdomainFromHost,
  tenantDomainSuffix,
  tenantGatewaySettings,
  tenantHost,
  tenantPublicUrl
} from '~~/server/utils/tenantDeploymentSettings'

interface TenantRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  display_name: string | null
  settings_json: unknown
}

interface SiteRow extends RowDataPacket {
  id: number
  public_url: string
  root_app_code: string | null
  environment: string
}

interface DeploymentRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  service_role: string | null
  deployment_code: string
  deployment_name: string
  environment: string
  status: string
  runtime_endpoint: string | null
  last_heartbeat_at: string | null
}

interface BootstrapSecretRow extends RowDataPacket {
  secret_last4: string | null
  updated_at: string
}

interface PolicyBundleRow extends RowDataPacket {
  id: number
  bundle_version: string
  bundle_hash: string
  bundle_uri: string
  schema_version: string
  signed_by_kid: string | null
  signed_at: string | null
  issued_at: string
  expires_at: string | null
  status: string
  environment: string
  target_count: number
  console_target_count: number
  console_deployment_code: string | null
}

const DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE = 'data-runtime.static_token'

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const environment = normalizeDeploymentEnvironment(getQuery(event).environment)
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  const [tenant, site, deployments, token, latestBundle] = await Promise.all([
    queryRow<TenantRow>(
      `SELECT tenant_code, tenant_name, display_name, settings_json
       FROM tenants
       WHERE tenant_code = ?
       LIMIT 1`,
      [tenantCode]
    ),
    queryRow<SiteRow>(
      `SELECT id, public_url, root_app_code, environment
       FROM deployment_sites
       WHERE tenant_code = ?
         AND environment = ?
         AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [tenantCode, environment]
    ),
    queryRows<DeploymentRow[]>(
      `SELECT d.id, d.app_code, pa.app_name, pa.service_role,
              d.deployment_code, d.deployment_name, d.environment, d.status, d.runtime_endpoint, d.last_heartbeat_at
       FROM deployments d
       LEFT JOIN platform_applications pa ON pa.app_code = d.app_code
       WHERE d.tenant_code = ?
         AND d.environment = ?
       ORDER BY CASE WHEN d.status = 'active' THEN 0 ELSE 1 END, d.app_code ASC`,
      [tenantCode, environment]
    ),
    queryRow<BootstrapSecretRow>(
      `SELECT s.secret_last4, s.updated_at
       FROM deployment_bootstrap_secrets s
       INNER JOIN deployments d ON d.id = s.deployment_id
       WHERE s.tenant_code = ?
         AND d.environment = ?
         AND s.secret_code = ?
         AND s.status = 'active'
       ORDER BY s.id DESC
       LIMIT 1`,
      [tenantCode, environment, DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE]
    ),
    queryRow<PolicyBundleRow>(
      `SELECT pb.id, pb.bundle_version, pb.bundle_hash, pb.bundle_uri, pb.schema_version,
              pb.environment,
              pb.signed_by_kid, pb.signed_at, pb.issued_at, pb.expires_at, pb.status,
              COUNT(pbt.id) AS target_count,
              COALESCE(SUM(CASE WHEN d.app_code = 'console' THEN 1 ELSE 0 END), 0) AS console_target_count,
              MAX(CASE WHEN d.app_code = 'console' THEN d.deployment_code ELSE NULL END) AS console_deployment_code
       FROM policy_bundles pb
       LEFT JOIN policy_bundle_targets pbt ON pbt.bundle_id = pb.id
       LEFT JOIN deployments d ON d.id = pbt.deployment_id
       WHERE pb.tenant_code = ?
         AND pb.environment = ?
       GROUP BY pb.id, pb.bundle_version, pb.bundle_hash, pb.bundle_uri, pb.schema_version,
                pb.environment, pb.signed_by_kid, pb.signed_at, pb.issued_at, pb.expires_at, pb.status
       ORDER BY pb.id DESC
       LIMIT 1`,
      [tenantCode, environment]
    )
  ])

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const suffix = tenantDomainSuffix()
  const settings = parseTenantSettings(tenant.settings_json)
  const tenantGateway = tenantGatewaySettings(settings, environment)
  const consoleLogin = consoleLoginSettings(settings, environment)
  const platform = platformEnvironmentSettings(settings, environment)
  const siteSubdomain = site?.public_url ? subdomainFromHost(site.public_url, suffix) : ''
  const subdomain = tenantGateway.subdomain || siteSubdomain || ''
  const defaultDataRuntimeEndpoint = dataRuntimeSettings(settings, environment).defaultEndpoint

  return ok({
    environment,
    environments: [
      { code: 'prod', label: '生产环境' },
      { code: 'test', label: '测试环境' }
    ],
    tenant: {
      tenantCode: tenant.tenant_code,
      tenantName: tenant.tenant_name,
      displayName: tenant.display_name
    },
    domain: {
      suffix,
      subdomain,
      host: subdomain ? tenantHost(subdomain, suffix) : '',
      publicUrl: subdomain ? tenantPublicUrl(subdomain, suffix) : site?.public_url || '',
      currentHost: hostFromUrl(site?.public_url),
      siteId: site?.id || null,
      rootAppCode: site?.root_app_code || null,
      environment
    },
    platform: {
      baseUrl: platform.baseUrl
    },
    dataRuntime: {
      defaultEndpoint: defaultDataRuntimeEndpoint,
      tokenLast4: token?.secret_last4 || null,
      tokenUpdatedAt: token?.updated_at || null
    },
    login: {
      mode: consoleLogin.mode,
      oidc: {
        providerCode: consoleLogin.oidc.providerCode,
        issuer: consoleLogin.oidc.issuer,
        authorizationEndpoint: consoleLogin.oidc.authorizationEndpoint,
        tokenEndpoint: consoleLogin.oidc.tokenEndpoint,
        userinfoEndpoint: consoleLogin.oidc.userinfoEndpoint,
        endSessionEndpoint: consoleLogin.oidc.endSessionEndpoint,
        jwksUri: consoleLogin.oidc.jwksUri,
        clientId: consoleLogin.oidc.clientId,
        scope: consoleLogin.oidc.scope,
        clientSecretConfigured: Boolean(consoleLogin.oidc.clientSecret)
      },
      cas: {
        baseUrl: consoleLogin.cas.baseUrl
      },
      wecom: {
        corpid: consoleLogin.wecom.corpid,
        agentid: consoleLogin.wecom.agentid,
        corpsecretConfigured: Boolean(consoleLogin.wecom.corpsecret)
      }
    },
    policyBundle: latestBundle
      ? {
          bundleId: latestBundle.id,
          bundleVersion: latestBundle.bundle_version,
          bundleHash: latestBundle.bundle_hash,
          bundleUri: latestBundle.bundle_uri,
          schemaVersion: latestBundle.schema_version,
          signedByKid: latestBundle.signed_by_kid,
          signedAt: latestBundle.signed_at,
          issuedAt: latestBundle.issued_at,
          expiresAt: latestBundle.expires_at,
          status: latestBundle.status,
          environment: latestBundle.environment,
          targetCount: Number(latestBundle.target_count || 0),
          consoleTargeted: Number(latestBundle.console_target_count || 0) > 0,
          consoleDeploymentCode: latestBundle.console_deployment_code || null
        }
      : null,
    deployments: deployments.map(item => ({
      id: item.id,
      appCode: item.app_code,
      appName: item.app_name || item.app_code,
      serviceRole: item.service_role,
      deploymentCode: item.deployment_code,
      deploymentName: item.deployment_name,
      environment: item.environment,
      status: item.status,
      runtimeEndpoint: item.runtime_endpoint,
      effectiveRuntimeEndpoint: item.runtime_endpoint || defaultDataRuntimeEndpoint,
      inheritsDefaultRuntimeEndpoint: !item.runtime_endpoint,
      lastHeartbeatAt: item.last_heartbeat_at
    }))
  })
})
