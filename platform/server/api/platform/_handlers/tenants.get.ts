import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface TenantRow extends RowDataPacket {
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
  application_count: number
  member_count: number
  deployment_count: number
  healthy_deployment_count: number
  warning_count: number
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const status = normalizeNullableString(query.status)
  const planCode = normalizeNullableString(query.planCode)
  const onboardingStage = normalizeNullableString(query.onboardingStage)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (status) {
    where.push('t.status = ?')
    params.push(status)
  }

  if (planCode) {
    where.push('COALESCE(ts.plan_code, \'\') = ?')
    params.push(planCode)
  }

  if (onboardingStage) {
    where.push('t.onboarding_stage = ?')
    params.push(onboardingStage)
  }

  if (keyword) {
    where.push('(t.tenant_code LIKE ? OR t.tenant_name LIKE ? OR COALESCE(t.display_name, \'\') LIKE ? OR COALESCE(t.primary_domain, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<TenantRow[]>(
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
            COALESCE(sc.application_count, 0) AS application_count,
            COALESCE(mc.member_count, 0) AS member_count,
            COALESCE(dc.deployment_count, 0) AS deployment_count,
            COALESCE(dc.healthy_deployment_count, 0) AS healthy_deployment_count,
            COALESCE(dc.warning_count, 0) AS warning_count,
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
       SELECT tenant_code, COUNT(DISTINCT app_code) AS application_count
       FROM subscriptions
       WHERE status = 'active'
       GROUP BY tenant_code
     ) sc ON sc.tenant_code = t.tenant_code
     LEFT JOIN (
       SELECT tenant_code,
              COUNT(*) AS member_count,
              MAX(last_accessed_at) AS last_accessed_at
       FROM tenant_account_memberships
       WHERE status = 'active'
       GROUP BY tenant_code
     ) mc ON mc.tenant_code = t.tenant_code
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
     ${whereSql}
     ORDER BY t.tenant_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
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
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      tenantName: item.tenant_name,
      displayName: item.display_name,
      tenantType: item.tenant_type,
      primaryDomain: item.primary_domain,
      status: item.status,
      defaultAuthMode: item.default_auth_mode,
      defaultDeploymentMode: item.default_deployment_mode,
      onboardingStage: item.onboarding_stage,
      planCode: item.plan_code,
      subscriptionStatus: item.subscription_status,
      subscriptionStartedAt: item.subscription_started_at,
      subscriptionEndedAt: item.subscription_ended_at,
      applicationCount: Number(item.application_count || 0),
      memberCount: Number(item.member_count || 0),
      deploymentCount: Number(item.deployment_count || 0),
      healthyDeploymentCount: Number(item.healthy_deployment_count || 0),
      warningCount: Number(item.warning_count || 0),
      lastActivityAt: item.last_activity_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
