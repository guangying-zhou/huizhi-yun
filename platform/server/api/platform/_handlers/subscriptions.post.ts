import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { buildLicensePayload, buildSignedLicenseToken, hashLicensePayload, normalizeLicenseCapabilities } from '~~/server/utils/licenseArtifacts'
import { getSubscriptionByAppCode } from '~~/server/utils/subscriptions'
import { CONSOLE_APP_CODE } from '~~/server/utils/consoleApp'
import { ensureConsoleVaultMasterKey, fingerprintConsoleVaultMasterKey } from '~~/server/utils/deploymentBootstrapSecrets'
import { buildDeploymentRouteDefaults, findActiveDeploymentSite } from '~~/server/utils/deploymentSites'
import { DEFAULT_DEPLOYMENT_ENVIRONMENT, normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

const ALLOWED_DEPLOYMENT_MODES = new Set(['managed-control-plane', 'self-hosted-enterprise', 'customer-hosted'])
const ALLOWED_DEPLOYMENT_STATUSES = new Set(['active', 'suspended', 'disabled'])
const ALLOWED_LICENSE_STATUSES = new Set(['active', 'grace', 'expired', 'suspended', 'disabled'])
const ALLOWED_SUBSCRIPTION_STATUSES = new Set(['pending', 'active', 'suspended', 'ended', 'cancelled'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

function buildSubscriptionNo(tenantCode: string, appCode: string) {
  const normalizedTenant = tenantCode.slice(-6)
  const normalizedApp = appCode.slice(0, 12)
  return `SUB-${normalizedTenant}-${normalizedApp}-${Date.now()}`
}

function deploymentCodeForEnvironment(tenantCode: string, appCode: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `${tenantCode}-${appCode}`
    : `${tenantCode}-${environment}-${appCode}`
}

function licenseCodeForEnvironment(tenantCode: string, appCode: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `LIC-${tenantCode}-${appCode.toUpperCase()}`
    : `LIC-${tenantCode}-${appCode.toUpperCase()}-${environment.toUpperCase()}`
}

interface TenantSubscriptionPlanRow extends RowDataPacket {
  id: number
  plan_code: string
  started_at: string | null
  ended_at: string | null
  plan_id: number | null
}

interface PlanCapabilityRow extends RowDataPacket {
  capability_code: string
  capability_value: string | null
}

async function loadPlanCapabilities(planId: number | null | undefined) {
  if (!planId) {
    return []
  }

  const rows = await queryRows<PlanCapabilityRow[]>(
    `SELECT capability_code, capability_value
     FROM platform_plan_capabilities
     WHERE plan_id = ?
     ORDER BY capability_code`,
    [planId]
  )

  return rows.map(row => ({
    capabilityCode: row.capability_code,
    capabilityValue: row.capability_value
  }))
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const isTenantAdminRequest = event.context.platformAccessScope === 'tenant-admin'
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const appCode = requireString(body.appCode, 'appCode')

  const tenant = await queryRow<RowDataPacket>(
    'SELECT id, tenant_name FROM tenants WHERE tenant_code = ? LIMIT 1',
    [tenantCode]
  )

  if (!tenant) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `tenant not found: tenantCode=${tenantCode}` })
  }

  const application = await queryRow<RowDataPacket & { app_name: string, runtime_mode: string }>(
    `SELECT id, app_name, runtime_mode
     FROM platform_applications
     WHERE app_code = ?
     LIMIT 1`,
    [appCode]
  )

  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: appCode=${appCode}` })
  }

  const tenantPlan = await queryRow<TenantSubscriptionPlanRow>(
    `SELECT ts.id, ts.plan_code, ts.started_at, ts.ended_at, pp.id AS plan_id
     FROM tenant_subscriptions ts
     LEFT JOIN platform_plans pp ON pp.plan_code = ts.plan_code
     WHERE ts.tenant_code = ?
       AND ts.status = 'active'
     ORDER BY ts.updated_at DESC, ts.id DESC
     LIMIT 1`,
    [tenantCode]
  )

  const planCodeInput = normalizeNullableString(body.planCode)
  const planCode = planCodeInput || tenantPlan?.plan_code || 'pending_plan'
  const issueLicense = Boolean(planCodeInput || tenantPlan?.plan_code)
  const plan = issueLicense
    ? await queryRow<RowDataPacket & { id: number }>(
        `SELECT id
         FROM platform_plans
         WHERE plan_code = ?
         LIMIT 1`,
        [planCode]
      )
    : null
  const capabilityPayload = normalizeLicenseCapabilities(
    Array.isArray(body.capabilities)
      ? body.capabilities
      : await loadPlanCapabilities(Number(plan?.id || tenantPlan?.plan_id || 0))
  )
  const subscriptionStatus = requireAllowed(
    normalizeNullableString(body.subscriptionStatus) || 'active',
    'subscriptionStatus',
    ALLOWED_SUBSCRIPTION_STATUSES
  )

  const deploymentMode = requireAllowed(
    normalizeNullableString(body.deploymentMode) || String(application.runtime_mode || 'customer-hosted'),
    'deploymentMode',
    ALLOWED_DEPLOYMENT_MODES
  )
  const deploymentStatus = requireAllowed(
    normalizeNullableString(body.deploymentStatus) || (issueLicense ? 'active' : 'suspended'),
    'deploymentStatus',
    ALLOWED_DEPLOYMENT_STATUSES
  )
  const licenseStatus = issueLicense
    ? requireAllowed(normalizeNullableString(body.licenseStatus) || 'active', 'licenseStatus', ALLOWED_LICENSE_STATUSES)
    : 'pending'

  const environment = normalizeDeploymentEnvironment(body.environment)
  const deploymentCode = normalizeNullableString(body.deploymentCode) || deploymentCodeForEnvironment(tenantCode, appCode, environment)
  const deploymentName = normalizeNullableString(body.deploymentName) || `${String(application.app_name)} · ${tenantCode}`
  const region = normalizeNullableString(body.region)
  const connectivityStatus = normalizeNullableString(body.connectivityStatus) || 'pending'
  const runtimeEndpointInputProvided = isTenantAdminRequest && body.runtimeEndpoint !== undefined
  const callbackUrlInputProvided = !isTenantAdminRequest && body.callbackUrl !== undefined
  const runtimeEndpointInput = runtimeEndpointInputProvided ? normalizeNullableString(body.runtimeEndpoint) : undefined
  const callbackUrlInput = callbackUrlInputProvided ? normalizeNullableString(body.callbackUrl) : undefined
  const basePathInput = !isTenantAdminRequest && body.basePath !== undefined ? normalizeNullableString(body.basePath) : undefined
  const apiBaseInput = !isTenantAdminRequest && body.apiBase !== undefined ? normalizeNullableString(body.apiBase) : undefined

  const licenseCode = normalizeNullableString(body.licenseCode) || licenseCodeForEnvironment(tenantCode, appCode, environment)
  const issuedAt = normalizeNullableString(body.issuedAt) || normalizeNullableString(tenantPlan?.started_at) || new Date().toISOString().slice(0, 19).replace('T', ' ')
  const expiresAt = normalizeNullableString(body.expiresAt) || normalizeNullableString(tenantPlan?.ended_at)
  const graceUntil = normalizeNullableString(body.graceUntil)

  await withTransaction(async (tx) => {
    const existingByCode = await tx.queryRow<RowDataPacket & { tenant_code: string, app_code: string, environment: string }>(
      `SELECT id, tenant_code, app_code, environment
       FROM deployments
       WHERE deployment_code = ?
       LIMIT 1`,
      [deploymentCode]
    )

    if (
      existingByCode
      && (
        String(existingByCode.tenant_code) !== tenantCode
        || String(existingByCode.app_code) !== appCode
        || String(existingByCode.environment) !== environment
      )
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `deploymentCode already used by tenantCode=${String(existingByCode.tenant_code)}, appCode=${String(existingByCode.app_code)}, environment=${String(existingByCode.environment)}`
      })
    }

    const existingSubscription = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM subscriptions
       WHERE tenant_code = ?
         AND app_code = ?
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [tenantCode, appCode]
    )

    let subscriptionId = Number(existingSubscription?.id || 0)

    if (subscriptionId > 0) {
      await tx.execute<ResultSetHeader>(
        `UPDATE subscriptions
         SET tenant_subscription_id = COALESCE(?, tenant_subscription_id),
             plan_code = ?, status = ?,
             started_at = COALESCE(started_at, NOW()),
             ended_at = CASE WHEN ? IN ('ended', 'cancelled') THEN COALESCE(ended_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = ?`,
        [tenantPlan?.id || null, planCode, subscriptionStatus, subscriptionStatus, subscriptionId]
      )
    } else {
      const subscriptionResult = tenantPlan?.id
        ? await tx.execute<ResultSetHeader>(
            `INSERT INTO subscriptions
              (subscription_no, tenant_subscription_id, tenant_code, app_code, plan_code, status, source, started_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'ops_grant', NOW(), NOW(), NOW())`,
            [buildSubscriptionNo(tenantCode, appCode), tenantPlan.id, tenantCode, appCode, planCode, subscriptionStatus]
          )
        : await tx.execute<ResultSetHeader>(
            `INSERT INTO subscriptions
              (subscription_no, tenant_code, app_code, plan_code, status, source, started_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ops_grant', NOW(), NOW(), NOW())`,
            [buildSubscriptionNo(tenantCode, appCode), tenantCode, appCode, planCode, subscriptionStatus]
          )
      subscriptionId = subscriptionResult.insertId
    }

    let site = await findActiveDeploymentSite(tenantCode, tx, environment)
    if (deploymentStatus === 'active' && !site) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `active deployment site not configured: tenantCode=${tenantCode}, environment=${environment}`
      })
    }

    const existingDeployment = await tx.queryRow<RowDataPacket & {
      id: number
      runtime_endpoint: string | null
      callback_url: string | null
      base_path: string | null
      api_base: string | null
    }>(
      `SELECT id, runtime_endpoint, callback_url, base_path, api_base
       FROM deployments
       WHERE tenant_code = ?
         AND app_code = ?
         AND environment = ?
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC
       LIMIT 1`,
      [tenantCode, appCode, environment]
    )

    const routeBasePathInput = isTenantAdminRequest
      ? normalizeNullableString(existingDeployment?.base_path) || undefined
      : basePathInput
    const routeApiBaseInput = isTenantAdminRequest
      ? normalizeNullableString(existingDeployment?.api_base) || undefined
      : apiBaseInput

    if (site && routeBasePathInput === '/') {
      const existingRootDeployment = await tx.queryRow<RowDataPacket & { app_code: string, deployment_code: string }>(
        `SELECT app_code, deployment_code
         FROM deployments
         WHERE site_id = ?
           AND base_path = '/'
           AND status = 'active'
           AND app_code <> ?
         LIMIT 1`,
        [site.id, appCode]
      )

      if (existingRootDeployment) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Conflict',
          message: `deployment root path already used by appCode=${String(existingRootDeployment.app_code)}`
        })
      }

      if (!isTenantAdminRequest && site.root_app_code !== appCode) {
        await tx.execute<ResultSetHeader>(
          `UPDATE deployment_sites
           SET root_app_code = ?, updated_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [appCode, site.id]
        )
        site = {
          ...site,
          root_app_code: appCode
        }
      }
    } else if (!isTenantAdminRequest && body.basePath !== undefined && site?.root_app_code === appCode) {
      await tx.execute<ResultSetHeader>(
        `UPDATE deployment_sites
         SET root_app_code = NULL, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [site.id]
      )
      site = {
        ...site,
        root_app_code: null
      }
    }

    const route = buildDeploymentRouteDefaults({
      appCode,
      site,
      basePath: routeBasePathInput,
      apiBase: routeApiBaseInput
    })

    let deploymentId = Number(existingDeployment?.id || 0)
    const runtimeEndpoint = runtimeEndpointInputProvided
      ? runtimeEndpointInput
      : normalizeNullableString(existingDeployment?.runtime_endpoint)
    const callbackUrl = callbackUrlInputProvided
      ? callbackUrlInput
      : normalizeNullableString(existingDeployment?.callback_url)

    if (deploymentId > 0) {
      await tx.execute<ResultSetHeader>(
        `UPDATE deployments
         SET subscription_id = ?, deployment_code = ?, deployment_name = ?, deployment_mode = ?,
             environment = ?, region = ?, status = ?, license_status = ?, connectivity_status = ?,
             site_id = ?, base_path = ?, api_base = ?, route_source = ?,
             runtime_endpoint = ?, callback_url = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          subscriptionId,
          deploymentCode,
          deploymentName,
          deploymentMode,
          environment,
          region,
          deploymentStatus,
          licenseStatus,
          connectivityStatus,
          route.siteId,
          route.basePath,
          route.apiBase,
          route.routeSource,
          runtimeEndpoint,
          callbackUrl,
          deploymentId
        ]
      )
    } else {
      const deploymentResult = await tx.execute<ResultSetHeader>(
        `INSERT INTO deployments
          (tenant_code, app_code, subscription_id, deployment_code, deployment_name, deployment_mode,
           environment, region, status, license_status, connectivity_status,
           site_id, base_path, api_base, route_source, runtime_endpoint, callback_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          tenantCode,
          appCode,
          subscriptionId,
          deploymentCode,
          deploymentName,
          deploymentMode,
          environment,
          region,
          deploymentStatus,
          licenseStatus,
          connectivityStatus,
          route.siteId,
          route.basePath,
          route.apiBase,
          route.routeSource,
          runtimeEndpoint,
          callbackUrl
        ]
      )
      deploymentId = deploymentResult.insertId
    }

    if (!issueLicense) {
      await tx.execute<ResultSetHeader>(
        `UPDATE license_deployments
         SET status = 'inactive', effective_until = COALESCE(effective_until, NOW())
         WHERE deployment_id = ?
           AND status = 'active'`,
        [deploymentId]
      )
      await tx.execute<ResultSetHeader>(
        `UPDATE deployments
         SET license_status = 'pending', updated_at = NOW()
         WHERE id = ?`,
        [deploymentId]
      )
      return
    }

    const consoleVaultMasterKey = appCode === CONSOLE_APP_CODE
      ? await ensureConsoleVaultMasterKey({
          deploymentId,
          tenantCode,
          appCode,
          executor: tx
        })
      : null

    const licensePayload = buildLicensePayload({
      tenantCode,
      appCode,
      deploymentId,
      deploymentCode,
      licenseCode,
      planCode,
      issuedAt,
      expiresAt,
      graceUntil,
      capabilities: capabilityPayload,
      vault: consoleVaultMasterKey
        ? {
            masterKeyRequired: true,
            masterKeyFingerprint: fingerprintConsoleVaultMasterKey(consoleVaultMasterKey),
            algorithm: 'aes-256-gcm'
          }
        : null
    })
    const payloadHash = hashLicensePayload(licensePayload)
    const signed = await buildSignedLicenseToken(licensePayload)

    const existingLicense = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM licenses
       WHERE tenant_code = ?
         AND license_code = ?
       LIMIT 1`,
      [tenantCode, licenseCode]
    )

    let licenseId = Number(existingLicense?.id || 0)

    if (licenseId > 0) {
      await tx.execute<ResultSetHeader>(
        `UPDATE licenses
         SET subscription_id = ?, plan_code = ?, status = ?, issued_at = ?, expires_at = ?, grace_until = ?,
             payload_hash = ?, signed_token = ?, updated_at = NOW()
         WHERE id = ?`,
        [subscriptionId, planCode, licenseStatus, issuedAt, expiresAt, graceUntil, payloadHash, signed.token, licenseId]
      )
    } else {
      const licenseResult = await tx.execute<ResultSetHeader>(
        `INSERT INTO licenses
          (license_code, subscription_id, tenant_code, plan_code, status, issued_at, expires_at, grace_until, payload_hash, signed_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [licenseCode, subscriptionId, tenantCode, planCode, licenseStatus, issuedAt, expiresAt, graceUntil, payloadHash, signed.token]
      )
      licenseId = licenseResult.insertId
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE license_deployments
       SET status = 'inactive', effective_until = COALESCE(effective_until, NOW())
       WHERE license_id = ?
         AND deployment_id <> ?
         AND status = 'active'`,
      [licenseId, deploymentId]
    )

    const existingMapping = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM license_deployments
       WHERE license_id = ?
         AND deployment_id = ?
       LIMIT 1`,
      [licenseId, deploymentId]
    )

    if (existingMapping) {
      await tx.execute<ResultSetHeader>(
        `UPDATE license_deployments
         SET status = 'active', effective_from = COALESCE(effective_from, NOW()), effective_until = NULL
         WHERE id = ?`,
        [existingMapping.id]
      )
    } else {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO license_deployments
          (license_id, deployment_id, effective_from, status, created_at)
         VALUES (?, ?, NOW(), 'active', NOW())`,
        [licenseId, deploymentId]
      )
    }

    await tx.execute<ResultSetHeader>('DELETE FROM license_capabilities WHERE license_id = ?', [licenseId])

    for (const capability of capabilityPayload) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO license_capabilities
          (license_id, capability_code, capability_value, created_at)
         VALUES (?, ?, ?, NOW())`,
        [licenseId, capability.capabilityCode, capability.capabilityValue]
      )
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE deployments
       SET license_status = ?, updated_at = NOW()
       WHERE id = ?`,
      [licenseStatus, deploymentId]
    )
  })

  const subscription = await getSubscriptionByAppCode(tenantCode, appCode)
  if (!subscription) {
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load saved subscription' })
  }

  return ok(subscription)
})
