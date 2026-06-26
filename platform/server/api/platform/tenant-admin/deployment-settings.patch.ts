import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { queryRows, withTransaction } from '~~/server/utils/db'
import { ensureDeploymentSite, findActiveDeploymentSite } from '~~/server/utils/deploymentSites'
import {
  deploymentEnvironmentSettings,
  hostFromUrl,
  normalizeConsoleLoginMode,
  normalizeDataRuntimeEndpoint,
  normalizeDeploymentEnvironment,
  normalizeHttpUrl,
  parseTenantSettings,
  tenantDomainSuffix,
  tenantHost,
  tenantPublicUrl,
  tenantGatewaySettings,
  validateTenantSubdomain
} from '~~/server/utils/tenantDeploymentSettings'

interface TenantRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  primary_domain: string | null
  settings_json: unknown
}

interface SiteHostRow extends RowDataPacket {
  tenant_code: string
  public_url: string
  environment: string
}

interface TenantHostRow extends RowDataPacket {
  tenant_code: string
  primary_domain: string | null
  settings_json: unknown
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function optionalHttpUrl(value: unknown, fieldName: string) {
  const raw = stringValue(value)
  return raw ? normalizeHttpUrl(raw, fieldName) || '' : ''
}

function assertOidcEndpointNotConsoleCallback(value: string, fieldName: string) {
  if (!value) return

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }

  if (url.pathname === '/api/auth/oidc-callback') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${fieldName} must be the upstream IdP endpoint, not the Console callback URL. Configure https://<tenant-domain>/api/auth/oidc-callback only in the IdP allowed redirect URIs.`
    })
  }
}

function normalizeConsoleLoginInput(body: Record<string, unknown>, previousSettings: Record<string, unknown>) {
  const login = recordValue(body.consoleLogin)
  const oidc = recordValue(login.oidc)
  const cas = recordValue(login.cas)
  const wecom = recordValue(login.wecom)
  const previousLogin = recordValue(previousSettings.consoleLogin)
  const previousOidc = recordValue(previousLogin.oidc)
  const previousWecom = recordValue(previousLogin.wecom)
  const mode = normalizeConsoleLoginMode(login.mode)

  const nextOidcClientSecret = stringValue(oidc.clientSecret)
    || stringValue(previousOidc.clientSecret)
  const nextWecomCorpsecret = stringValue(wecom.corpsecret)
    || stringValue(previousWecom.corpsecret)

  const next = {
    mode,
    oidc: {
      providerCode: stringValue(oidc.providerCode) || 'sso_oidc',
      issuer: optionalHttpUrl(oidc.issuer, 'consoleLogin.oidc.issuer'),
      authorizationEndpoint: optionalHttpUrl(oidc.authorizationEndpoint, 'consoleLogin.oidc.authorizationEndpoint'),
      tokenEndpoint: optionalHttpUrl(oidc.tokenEndpoint, 'consoleLogin.oidc.tokenEndpoint'),
      userinfoEndpoint: optionalHttpUrl(oidc.userinfoEndpoint, 'consoleLogin.oidc.userinfoEndpoint'),
      endSessionEndpoint: optionalHttpUrl(oidc.endSessionEndpoint, 'consoleLogin.oidc.endSessionEndpoint'),
      jwksUri: optionalHttpUrl(oidc.jwksUri, 'consoleLogin.oidc.jwksUri'),
      clientId: stringValue(oidc.clientId),
      ...(nextOidcClientSecret ? { clientSecret: nextOidcClientSecret } : {}),
      scope: stringValue(oidc.scope) || 'openid profile email'
    },
    cas: {
      baseUrl: optionalHttpUrl(cas.baseUrl, 'consoleLogin.cas.baseUrl')
    },
    wecom: {
      corpid: stringValue(wecom.corpid),
      agentid: stringValue(wecom.agentid),
      ...(nextWecomCorpsecret ? { corpsecret: nextWecomCorpsecret } : {})
    }
  }

  if (mode === 'oidc') {
    assertOidcEndpointNotConsoleCallback(next.oidc.issuer, 'consoleLogin.oidc.issuer')
    assertOidcEndpointNotConsoleCallback(next.oidc.authorizationEndpoint, 'consoleLogin.oidc.authorizationEndpoint')
    assertOidcEndpointNotConsoleCallback(next.oidc.tokenEndpoint, 'consoleLogin.oidc.tokenEndpoint')
    assertOidcEndpointNotConsoleCallback(next.oidc.userinfoEndpoint, 'consoleLogin.oidc.userinfoEndpoint')
    assertOidcEndpointNotConsoleCallback(next.oidc.jwksUri, 'consoleLogin.oidc.jwksUri')

    if (!next.oidc.clientId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'consoleLogin.oidc.clientId is required when login mode is oidc'
      })
    }
    if (!next.oidc.issuer && (!next.oidc.authorizationEndpoint || !next.oidc.tokenEndpoint)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'consoleLogin.oidc requires issuer or both authorizationEndpoint and tokenEndpoint'
      })
    }
  }

  if (mode === 'cas' && !next.cas.baseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'consoleLogin.cas.baseUrl is required when login mode is cas'
    })
  }

  if (mode === 'wecom' && (!next.wecom.corpid || !next.wecom.agentid || !next.wecom.corpsecret)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'consoleLogin.wecom corpid, agentid and corpsecret are required when login mode is wecom'
    })
  }

  return next
}

async function assertSubdomainAvailable(input: {
  tenantCode: string
  environment: string
  subdomain: string
  suffix: string
}) {
  const host = tenantHost(input.subdomain, input.suffix)
  const [sites, tenants] = await Promise.all([
    queryRows<SiteHostRow[]>(
      `SELECT tenant_code, public_url, environment
       FROM deployment_sites
       WHERE status = 'active'`
    ),
    queryRows<TenantHostRow[]>(
      `SELECT tenant_code, primary_domain, settings_json
       FROM tenants`
    )
  ])

  const siteConflict = sites.find(site =>
    (site.tenant_code !== input.tenantCode || site.environment !== input.environment)
    && hostFromUrl(site.public_url) === host
  )
  if (siteConflict) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `tenantSubdomain is already used by tenantCode=${siteConflict.tenant_code}`
    })
  }

  const tenantConflict = tenants.find((tenant) => {
    if (tenant.tenant_code === input.tenantCode) return false
    if (hostFromUrl(tenant.primary_domain) === host) return true

    const settings = parseTenantSettings(tenant.settings_json)
    if (tenantGatewaySettings(settings).subdomain === input.subdomain) return true

    const environments = recordValue(settings.deploymentEnvironments)
    return Object.keys(environments).some((environment) => {
      try {
        return tenantGatewaySettings(settings, environment).subdomain === input.subdomain
      } catch {
        return false
      }
    })
  })
  if (tenantConflict) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `tenantSubdomain is already used by tenantCode=${tenantConflict.tenant_code}`
    })
  }
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const membership = event.context.platformTenantMembership
  const accountId = Number(event.context.platformAccountId || 0) || null

  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  if (!membership?.isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'only tenant owner can update deployment settings'
    })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const environment = normalizeDeploymentEnvironment(body.environment || getQuery(event).environment)
  const suffix = tenantDomainSuffix()
  const subdomain = await validateTenantSubdomain(body.tenantSubdomain)
  const defaultDataRuntimeEndpoint = normalizeDataRuntimeEndpoint(body.defaultDataRuntimeEndpoint)
  const platformBaseUrl = normalizeNullableString(body.platformBaseUrl)
    ? normalizeHttpUrl(body.platformBaseUrl, 'platformBaseUrl')
    : null

  await assertSubdomainAvailable({
    tenantCode,
    environment,
    subdomain,
    suffix
  })

  const saved = await withTransaction(async (tx) => {
    const tenant = await tx.queryRow<TenantRow>(
      `SELECT tenant_code, tenant_name, primary_domain, settings_json
       FROM tenants
       WHERE tenant_code = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantCode]
    )

    if (!tenant) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `tenant not found: tenantCode=${tenantCode}`
      })
    }

    const settings = parseTenantSettings(tenant.settings_json)
    const previousEnvironmentSettings = deploymentEnvironmentSettings(settings, environment)
    const consoleLogin = normalizeConsoleLoginInput(body, previousEnvironmentSettings)
    const environments = recordValue(settings.deploymentEnvironments)
    const previousScopedSettings = recordValue(environments[environment])
    const nextScopedSettings = {
      ...previousScopedSettings,
      tenantGateway: {
        ...recordValue(previousScopedSettings.tenantGateway),
        subdomain
      },
      dataRuntime: {
        ...recordValue(previousScopedSettings.dataRuntime),
        defaultEndpoint: defaultDataRuntimeEndpoint
      },
      platform: {
        ...recordValue(previousScopedSettings.platform),
        baseUrl: platformBaseUrl
      },
      consoleLogin
    }
    const nextSettings = {
      ...settings,
      deploymentEnvironments: {
        ...environments,
        [environment]: nextScopedSettings
      },
      ...(environment === 'prod'
        ? {
            tenantGateway: nextScopedSettings.tenantGateway,
            dataRuntime: nextScopedSettings.dataRuntime,
            platform: nextScopedSettings.platform,
            consoleLogin
          }
        : {})
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE tenants
       SET settings_json = ?, updated_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?`,
      [JSON.stringify(nextSettings), tenantCode]
    )

    const existingSite = await findActiveDeploymentSite(tenantCode, tx, environment)
    const site = await ensureDeploymentSite({
      executor: tx,
      tenantCode,
      tenantName: tenant.tenant_name,
      publicUrl: tenantPublicUrl(subdomain, suffix),
      rootAppCode: existingSite?.root_app_code || null,
      environment,
      createdByAccountId: accountId
    })

    return {
      tenantCode,
      environment,
      tenantSubdomain: subdomain,
      tenantHost: tenantHost(subdomain, suffix),
      publicUrl: site.public_url,
      platformBaseUrl,
      defaultDataRuntimeEndpoint: normalizeNullableString(defaultDataRuntimeEndpoint)
    }
  })

  return ok(saved)
})
