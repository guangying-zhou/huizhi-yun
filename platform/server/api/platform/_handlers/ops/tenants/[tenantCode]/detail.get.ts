import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'

interface TenantDetailRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  status: string
  default_auth_mode: string
  default_deployment_mode: string
  onboarding_stage: string
  plan_code: string | null
  subscription_status: string | null
  subscription_started_at: string | null
  subscription_ended_at: string | null
  user_count: number
  subject_count: number
  member_count: number
  role_count: number
  template_count: number
  application_count: number
  deployment_count: number
  healthy_deployment_count: number
  warning_count: number
  license_count: number
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

function requireTenantCode(event: H3Event) {
  return requireString(getRouterParam(event, 'tenantCode'), 'tenantCode').trim()
}

export default defineEventHandler(async (event) => {
  const tenantCode = requireTenantCode(event)

  const row = await queryRow<TenantDetailRow>(
    `SELECT t.id,
            t.tenant_code,
            t.tenant_name,
            t.display_name,
            t.tenant_type,
            t.primary_domain,
            t.status,
            t.default_auth_mode,
            t.default_deployment_mode,
            t.onboarding_stage,
            ts.plan_code,
            ts.status AS subscription_status,
            ts.started_at AS subscription_started_at,
            ts.ended_at AS subscription_ended_at,
            COALESCE(sm.user_count, 0) AS user_count,
            COALESCE(sm.subject_count, 0) AS subject_count,
            COALESCE(mc.member_count, 0) AS member_count,
            COALESCE(rm.role_count, 0) AS role_count,
            COALESCE(tm.template_count, 0) AS template_count,
            COALESCE(ac.application_count, 0) AS application_count,
            COALESCE(dc.deployment_count, 0) AS deployment_count,
            COALESCE(dc.healthy_deployment_count, 0) AS healthy_deployment_count,
            COALESCE(dc.warning_count, 0) AS warning_count,
            COALESCE(lm.license_count, 0) AS license_count,
            NULLIF(
              GREATEST(
                COALESCE(dc.last_heartbeat_at, '1970-01-01 00:00:00'),
                COALESCE(mc.last_accessed_at, '1970-01-01 00:00:00'),
                COALESCE(t.updated_at, '1970-01-01 00:00:00')
              ),
              '1970-01-01 00:00:00'
            ) AS last_activity_at,
            t.created_at,
            t.updated_at
     FROM tenants t
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
     LEFT JOIN (
       SELECT tenant_code,
              COUNT(*) AS subject_count,
              COUNT(CASE WHEN subject_type = 'user' THEN 1 END) AS user_count
       FROM tenant_subjects
       GROUP BY tenant_code
     ) sm ON sm.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code,
              COUNT(*) AS member_count,
              MAX(last_accessed_at) AS last_accessed_at
       FROM tenant_account_memberships
       WHERE status = 'active'
       GROUP BY tenant_code
     ) mc ON mc.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code, COUNT(*) AS role_count
       FROM tenant_roles
       GROUP BY tenant_code
     ) rm ON rm.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code, COUNT(*) AS template_count
       FROM tenant_permission_templates
       GROUP BY tenant_code
     ) tm ON tm.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code, COUNT(DISTINCT app_code) AS application_count
       FROM subscriptions
       WHERE status = 'active'
       GROUP BY tenant_code
     ) ac ON ac.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code,
              COUNT(CASE WHEN status = 'active' THEN 1 END) AS deployment_count,
              COUNT(CASE
                WHEN status = 'active'
                 AND connectivity_status = 'passed'
                 AND version_status NOT IN ('drifted', 'incompatible')
                THEN 1
              END) AS healthy_deployment_count,
              COUNT(CASE
                WHEN status = 'active'
                 AND (
                   connectivity_status <> 'passed'
                   OR version_status IN ('drifted', 'incompatible')
                   OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))
                 )
                THEN 1
              END) AS warning_count,
              MAX(last_heartbeat_at) AS last_heartbeat_at
       FROM deployments
       GROUP BY tenant_code
     ) dc ON dc.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code, COUNT(*) AS license_count
       FROM licenses
       GROUP BY tenant_code
     ) lm ON lm.tenant_code = t.tenant_code
     WHERE t.tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  return ok({
    tenant: {
      id: row.id,
      tenantCode: row.tenant_code,
      tenantName: row.tenant_name,
      displayName: row.display_name,
      tenantType: row.tenant_type,
      primaryDomain: row.primary_domain,
      status: row.status,
      defaultAuthMode: row.default_auth_mode,
      defaultDeploymentMode: row.default_deployment_mode,
      onboardingStage: row.onboarding_stage,
      planCode: row.plan_code,
      subscriptionStatus: row.subscription_status,
      subscriptionStartedAt: row.subscription_started_at,
      subscriptionEndedAt: row.subscription_ended_at,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    summary: {
      userCount: Number(row.user_count || 0),
      subjectCount: Number(row.subject_count || 0),
      memberCount: Number(row.member_count || 0),
      roleCount: Number(row.role_count || 0),
      templateCount: Number(row.template_count || 0),
      applicationCount: Number(row.application_count || 0),
      deploymentCount: Number(row.deployment_count || 0),
      healthyDeploymentCount: Number(row.healthy_deployment_count || 0),
      warningCount: Number(row.warning_count || 0),
      licenseCount: Number(row.license_count || 0)
    }
  })
})
