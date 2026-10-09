import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { listSubscriptions } from '~~/server/utils/subscriptions'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface TenantOverviewRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  industry_category: string | null
  company_size: string | null
  province: string | null
  city: string | null
  status: string
  default_deployment_mode: string
  deployment_public_url: string | null
  deployment_root_app_code: string | null
  plan_code: string | null
  plan_name: string | null
  subscription_started_at: string | null
  subscription_ended_at: string | null
}

interface SubjectCountRow extends RowDataPacket {
  department_count: number
  user_count: number
}

interface LicenseExpiryRow extends RowDataPacket {
  next_expiry_at: string | null
}

function computeRemainingDays(expiryAt: string | null) {
  if (!expiryAt) return null

  const expiryTime = new Date(expiryAt).getTime()
  if (Number.isNaN(expiryTime)) return null

  const diffMs = expiryTime - Date.now()
  if (diffMs <= 0) return 0

  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode').trim()
  const environment = normalizeDeploymentEnvironment(query.environment)

  const tenant = await queryRow<TenantOverviewRow>(
    `SELECT t.tenant_code,
            t.tenant_name,
            t.display_name,
            t.tenant_type,
            t.primary_domain,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.industryCategory')) AS industry_category,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.companySize')) AS company_size,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.province')) AS province,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.city')) AS city,
            t.status,
            t.default_deployment_mode,
            ds.public_url AS deployment_public_url,
            ds.root_app_code AS deployment_root_app_code,
            ts.plan_code,
            pp.plan_name,
            ts.started_at AS subscription_started_at,
            ts.ended_at AS subscription_ended_at
     FROM tenants t
     LEFT JOIN deployment_sites ds
       ON ds.id = (
         SELECT ds2.id
         FROM deployment_sites ds2
         WHERE ds2.tenant_code = t.tenant_code
           AND ds2.environment = ?
           AND ds2.status = 'active'
         ORDER BY ds2.id DESC
         LIMIT 1
       )
     LEFT JOIN tenant_subscriptions ts
       ON ts.id = (
         SELECT ts2.id
         FROM tenant_subscriptions ts2
         WHERE ts2.tenant_code = t.tenant_code
         ORDER BY CASE WHEN ts2.status = 'active' THEN 0 ELSE 1 END,
                  ts2.updated_at DESC,
                  ts2.id DESC
         LIMIT 1
       )
     LEFT JOIN platform_plans pp ON pp.plan_code = ts.plan_code
    WHERE t.tenant_code = ?
    LIMIT 1`,
    [environment, tenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const [subjectCounts, nextExpiry, subscriptions] = await Promise.all([
    queryRow<SubjectCountRow>(
      `SELECT
          COUNT(CASE WHEN subject_type = 'department' AND status = 'active' THEN 1 END) AS department_count,
          COUNT(CASE WHEN subject_type = 'user' AND status = 'active' THEN 1 END) AS user_count
       FROM tenant_subjects
       WHERE tenant_code = ?`,
      [tenantCode]
    ),
    queryRow<LicenseExpiryRow>(
      `SELECT MIN(COALESCE(grace_until, expires_at)) AS next_expiry_at
       FROM licenses
       WHERE tenant_code = ?
         AND status IN ('active', 'grace')
         AND COALESCE(grace_until, expires_at) IS NOT NULL`,
      [tenantCode]
    ),
    listSubscriptions(tenantCode, { planScoped: true, page: 1, pageSize: 500 })
  ])

  const subscribedAppCount = subscriptions.items.filter(item => item.stage.key !== 'not_subscribed').length
  const enabledAppCount = subscriptions.items.filter(item => item.stage.key === 'active').length
  const deployedAppCount = subscriptions.items.filter(item => Boolean(item.deployment)).length
  const licensedAppCount = subscriptions.items.filter(item => Boolean(item.license)).length
  const platformServiceAppCount = subscriptions.items.filter(item => item.application.serviceRole === 'supporting_service').length
  const businessAppCount = subscriptions.items.filter(item => item.application.serviceRole === 'business_app').length

  return ok({
    tenant: {
      tenantCode: tenant.tenant_code,
      tenantName: tenant.tenant_name,
      displayName: tenant.display_name,
      tenantType: tenant.tenant_type,
      primaryDomain: tenant.primary_domain,
      industryCategory: tenant.industry_category,
      companySize: tenant.company_size,
      province: tenant.province,
      city: tenant.city,
      status: tenant.status,
      defaultDeploymentMode: tenant.default_deployment_mode,
      deploymentPublicUrl: tenant.deployment_public_url,
      deploymentRootAppCode: tenant.deployment_root_app_code,
      planCode: tenant.plan_code,
      planName: tenant.plan_name,
      subscriptionStartedAt: tenant.subscription_started_at,
      subscriptionEndedAt: tenant.subscription_ended_at
    },
    stats: {
      totalAppCount: subscriptions.total,
      enabledAppCount,
      subscribedAppCount,
      deployedAppCount,
      licensedAppCount,
      platformServiceAppCount,
      businessAppCount,
      departmentCount: Number(subjectCounts?.department_count || 0),
      userCount: Number(subjectCounts?.user_count || 0),
      subscriptionRemainingDays: computeRemainingDays(nextExpiry?.next_expiry_at || null),
      nextExpiryAt: nextExpiry?.next_expiry_at || null
    }
  })
})
