import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface StatRow extends RowDataPacket {
  active_tenant_count: number
  app_count: number
  released_app_count: number
  draft_release_count: number
  month_subscription_count: number
  deployment_count: number
  healthy_deployment_count: number
}

interface TenantRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  display_name: string | null
  plan_code: string | null
  status: string
  app_count: number
  warn_count: number
  last_heartbeat_at: string | null
}

interface AppRow extends RowDataPacket {
  app_code: string
  app_name: string
  icon: string | null
  status: string
  latest_release_version: string | null
  latest_release_status: string | null
  subscriber_count: number
}

interface AuditRow extends RowDataPacket {
  action: string
  target_type: string
  target_id: string
  target_tenant_code: string | null
  source: string | null
  created_at: string
  operator_uid: string | null
  operator_name: string | null
}

function relativeTime(value: string) {
  const date = new Date(value)
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))

  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

export default defineEventHandler(async () => {
  const stats = await queryRow<StatRow>(
    `SELECT
       (SELECT COUNT(*) FROM tenants WHERE status = 'active') AS active_tenant_count,
       (SELECT COUNT(*) FROM platform_applications WHERE status = 'active') AS app_count,
       (SELECT COUNT(*) FROM platform_applications WHERE latest_release_id IS NOT NULL AND status = 'active') AS released_app_count,
       (SELECT COUNT(*) FROM platform_app_releases WHERE status IN ('draft', 'permissions_pending', 'ready')) AS draft_release_count,
       (SELECT COUNT(*) FROM subscriptions WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS month_subscription_count,
       (SELECT COUNT(*) FROM deployments WHERE status = 'active') AS deployment_count,
       (SELECT COUNT(*) FROM deployments WHERE status = 'active' AND connectivity_status = 'passed') AS healthy_deployment_count`
  )

  const tenants = await queryRows<TenantRow[]>(
    `SELECT t.tenant_code,
            t.tenant_name,
            t.display_name,
            ts.plan_code,
            t.status,
            COUNT(DISTINCT s.app_code) AS app_count,
            COUNT(DISTINCT CASE
              WHEN d.status = 'active'
               AND (d.connectivity_status <> 'passed'
                OR d.version_status IN ('drifted', 'incompatible')
                OR (d.last_heartbeat_at IS NOT NULL AND d.last_heartbeat_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)))
              THEN d.id
              ELSE NULL
            END) AS warn_count,
            MAX(d.last_heartbeat_at) AS last_heartbeat_at
     FROM tenants t
     LEFT JOIN tenant_subscriptions ts
       ON ts.tenant_code = t.tenant_code
      AND ts.status = 'active'
     LEFT JOIN subscriptions s
       ON s.tenant_code = t.tenant_code
      AND s.status = 'active'
     LEFT JOIN deployments d
       ON d.tenant_code = t.tenant_code
     GROUP BY t.tenant_code,
              t.tenant_name,
              t.display_name,
              ts.plan_code,
              t.status
     ORDER BY FIELD(t.status, 'active', 'pending', 'suspended') ASC,
              t.updated_at DESC
     LIMIT 6`
  )

  const apps = await queryRows<AppRow[]>(
    `SELECT pa.app_code,
            pa.app_name,
            pa.icon,
            pa.status,
            lr.release_version AS latest_release_version,
            lr.status AS latest_release_status,
            COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.tenant_code ELSE NULL END) AS subscriber_count
     FROM platform_applications pa
     LEFT JOIN platform_app_releases lr
       ON lr.id = pa.latest_release_id
      AND lr.app_code = pa.app_code
     LEFT JOIN subscriptions s
       ON s.app_code = pa.app_code
     WHERE pa.status = 'active'
     GROUP BY pa.app_code,
              pa.app_name,
              pa.icon,
              pa.status,
              lr.release_version,
              lr.status
     ORDER BY COALESCE(pa.last_released_at, pa.updated_at) DESC
     LIMIT 6`
  )

  const timeline = await queryRows<AuditRow[]>(
    `SELECT pal.action,
            pal.target_type,
            pal.target_id,
            pal.target_tenant_code,
            pal.source,
            pal.created_at,
            pa.uid AS operator_uid,
            pa.display_name AS operator_name
     FROM platform_audit_logs pal
     LEFT JOIN platform_accounts pa
       ON pa.id = pal.operator_account_id
     ORDER BY pal.created_at DESC
     LIMIT 8`
  )

  const healthyDeploymentRate = stats?.deployment_count
    ? Math.round((Number(stats.healthy_deployment_count || 0) / Number(stats.deployment_count || 1)) * 1000) / 10
    : null

  return ok({
    stats: {
      activeTenantCount: Number(stats?.active_tenant_count || 0),
      appCount: Number(stats?.app_count || 0),
      releasedAppCount: Number(stats?.released_app_count || 0),
      draftReleaseCount: Number(stats?.draft_release_count || 0),
      monthSubscriptionCount: Number(stats?.month_subscription_count || 0),
      deploymentCount: Number(stats?.deployment_count || 0),
      healthyDeploymentCount: Number(stats?.healthy_deployment_count || 0),
      healthyDeploymentRate
    },
    tenants: tenants.map(item => ({
      tenantCode: item.tenant_code,
      tenantName: item.display_name || item.tenant_name,
      planCode: item.plan_code,
      status: item.status,
      appCount: Number(item.app_count || 0),
      warnCount: Number(item.warn_count || 0),
      lastHeartbeatAt: item.last_heartbeat_at,
      lastSeen: item.last_heartbeat_at ? relativeTime(item.last_heartbeat_at) : '—'
    })),
    apps: apps.map(item => ({
      appCode: item.app_code,
      appName: item.app_name,
      icon: item.icon,
      status: item.status,
      latestReleaseVersion: item.latest_release_version,
      latestReleaseStatus: item.latest_release_status,
      subscriberCount: Number(item.subscriber_count || 0)
    })),
    timeline: timeline.map(item => ({
      tone: item.action.includes('fail') || item.action.includes('reject') ? 'error' : 'info',
      time: relativeTime(item.created_at),
      who: item.operator_name || item.operator_uid || item.source || 'system',
      message: `${item.action} · ${item.target_type}:${item.target_id}`,
      targetTenantCode: item.target_tenant_code,
      createdAt: item.created_at
    }))
  })
})
