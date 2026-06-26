import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'

interface SubscriptionQueryOptions {
  keyword?: string | null
  appType?: string | null
  status?: string | null
  planScoped?: boolean
  page?: number
  pageSize?: number
}

interface SubscriptionRow extends RowDataPacket {
  application_id: number
  app_code: string
  app_name: string
  app_description: string | null
  app_icon: string | null
  app_type: string
  runtime_mode: string
  service_role: string
  auth_mode: string
  app_status: string
  subscription_id: number | null
  subscription_no: string | null
  subscription_plan_code: string | null
  subscription_status: string | null
  subscription_started_at: string | null
  entitlement_plan_code: string | null
  role_in_plan: string | null
  plan_sort_order: number | null
  deployment_id: number | null
  deployment_code: string | null
  deployment_name: string | null
  deployment_mode: string | null
  deployment_status: string | null
  deployment_license_status: string | null
  deployment_connectivity_status: string | null
  deployment_version_status: string | null
  deployment_site_id: number | null
  deployment_base_path: string | null
  deployment_api_base: string | null
  deployment_route_source: string | null
  deployment_runtime_endpoint: string | null
  deployment_callback_url: string | null
  last_heartbeat_at: string | null
  license_deployment_status: string | null
  license_id: number | null
  license_code: string | null
  plan_code: string | null
  license_status: string | null
  issued_at: string | null
  expires_at: string | null
  grace_until: string | null
  manifest_seq: number | null
  manifest_created_at: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export type SubscriptionStageKey
  = | 'not_subscribed'
    | 'selected'
    | 'deployment_pending'
    | 'active'
    | 'grace'
    | 'authorization_blocked'

function buildStage(row: SubscriptionRow) {
  if (!row.subscription_id) {
    if (row.entitlement_plan_code) {
      return {
        key: 'selected' as SubscriptionStageKey,
        label: '待开通',
        tone: 'warning'
      }
    }

    return {
      key: 'not_subscribed' as SubscriptionStageKey,
      label: '未启用',
      tone: 'neutral'
    }
  }

  if (!row.deployment_id) {
    return {
      key: 'selected' as SubscriptionStageKey,
      label: '待部署',
      tone: 'warning'
    }
  }

  if (!row.license_id || row.license_deployment_status !== 'active') {
    return {
      key: 'deployment_pending' as SubscriptionStageKey,
      label: '待授权',
      tone: 'warning'
    }
  }

  if (row.license_status === 'active' && row.license_deployment_status === 'active') {
    if (row.deployment_status === 'active' && row.deployment_connectivity_status === 'passed') {
      return {
        key: 'active' as SubscriptionStageKey,
        label: '正式启用',
        tone: 'success'
      }
    }

    return {
      key: 'deployment_pending' as SubscriptionStageKey,
      label: '待验收',
      tone: 'warning'
    }
  }

  if (row.license_status === 'grace') {
    return {
      key: 'grace' as SubscriptionStageKey,
      label: '授权宽限',
      tone: 'warning'
    }
  }

  return {
    key: 'authorization_blocked' as SubscriptionStageKey,
    label: '授权受限',
    tone: 'error'
  }
}

function mapSubscription(row: SubscriptionRow, tenantCode: string) {
  const stage = buildStage(row)

  return {
    application: {
      id: row.application_id,
      appCode: row.app_code,
      appName: row.app_name,
      description: row.app_description,
      icon: row.app_icon,
      appType: row.app_type,
      runtimeMode: row.runtime_mode,
      serviceRole: row.service_role,
      authMode: row.auth_mode,
      status: row.app_status
    },
    stage,
    entitlement: row.entitlement_plan_code
      ? {
          planCode: row.entitlement_plan_code,
          roleInPlan: row.role_in_plan,
          sortOrder: Number(row.plan_sort_order || 0)
        }
      : null,
    defaults: {
      deploymentCode: `${tenantCode}-${row.app_code}`,
      deploymentName: `${row.app_name} · ${tenantCode}`,
      licenseCode: `LIC-${tenantCode}-${row.app_code.toUpperCase()}`
    },
    deployment: row.deployment_id
      ? {
          id: row.deployment_id,
          appCode: row.app_code,
          deploymentCode: row.deployment_code,
          deploymentName: row.deployment_name,
          deploymentMode: row.deployment_mode,
          siteId: row.deployment_site_id,
          basePath: row.deployment_base_path,
          apiBase: row.deployment_api_base,
          routeSource: row.deployment_route_source,
          status: row.deployment_status,
          licenseStatus: row.deployment_license_status,
          connectivityStatus: row.deployment_connectivity_status,
          versionStatus: row.deployment_version_status,
          runtimeEndpoint: row.deployment_runtime_endpoint,
          callbackUrl: row.deployment_callback_url,
          lastHeartbeatAt: row.last_heartbeat_at
        }
      : null,
    license: row.license_id
      ? {
          id: row.license_id,
          licenseCode: row.license_code,
          planCode: row.plan_code,
          status: row.license_status,
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          graceUntil: row.grace_until
        }
      : null,
    manifest: row.manifest_seq != null
      ? {
          manifestSeq: row.manifest_seq,
          createdAt: row.manifest_created_at
        }
      : null
  }
}

function buildListWhere(options: SubscriptionQueryOptions) {
  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (options.planScoped) {
    where.push('pa.status = ?')
    params.push('active')
  }

  if (options.appType) {
    where.push('pa.app_type = ?')
    params.push(options.appType)
  }

  if (options.status) {
    switch (options.status) {
      case 'active':
        where.push(`s.id IS NOT NULL
          AND s.status = 'active'
          AND d.id IS NOT NULL
          AND d.status = 'active'
          AND d.connectivity_status = 'passed'
          AND l.id IS NOT NULL
          AND l.status = 'active'
          AND ld.status = 'active'`)
        break
      case 'selected':
        where.push(options.planScoped
          ? '(s.id IS NULL OR (s.id IS NOT NULL AND d.id IS NULL))'
          : 's.id IS NOT NULL AND d.id IS NULL')
        break
      case 'not_subscribed':
        where.push('s.id IS NULL')
        break
      case 'deployment_pending':
        where.push(`s.id IS NOT NULL
          AND (
            d.id IS NULL
            OR d.status <> 'active'
            OR d.connectivity_status <> 'passed'
            OR l.id IS NULL
            OR ld.status <> 'active'
          )`)
        break
      case 'authorization_blocked':
        where.push(`l.id IS NOT NULL
          AND (
            l.status IN ('expired', 'suspended', 'disabled')
            OR ld.status <> 'active'
          )`)
        break
      case 'grace':
        where.push(`l.id IS NOT NULL AND l.status = 'grace'`)
        break
    }
  }

  if (options.keyword) {
    where.push('(pa.app_code LIKE ? OR pa.app_name LIKE ? OR COALESCE(pa.description, \'\') LIKE ?)')
    params.push(`%${options.keyword}%`, `%${options.keyword}%`, `%${options.keyword}%`)
  }

  return {
    whereSql: `WHERE ${where.join(' AND ')}`,
    params
  }
}

function subscriptionJoins(options: SubscriptionQueryOptions = {}) {
  const planScopeSql = options.planScoped
    ? `FROM platform_plan_apps ppa
      INNER JOIN platform_plans pp ON pp.id = ppa.plan_id
      INNER JOIN tenant_subscriptions tscope
        ON tscope.plan_code = pp.plan_code
       AND tscope.id = (
          SELECT ts2.id
          FROM tenant_subscriptions ts2
          WHERE ts2.tenant_code = ?
            AND ts2.status = 'active'
          ORDER BY ts2.updated_at DESC, ts2.id DESC
          LIMIT 1
        )
      INNER JOIN platform_applications pa ON pa.app_code = ppa.app_code`
    : `FROM platform_applications pa`

  return `${planScopeSql}
      LEFT JOIN subscriptions s
        ON s.id = (
          SELECT s2.id
          FROM subscriptions s2
          WHERE s2.tenant_code = ?
            AND s2.app_code = pa.app_code
          ORDER BY CASE WHEN s2.status = 'active' THEN 0 ELSE 1 END, s2.updated_at DESC, s2.id DESC
          LIMIT 1
        )
      LEFT JOIN deployments d
        ON d.id = (
          SELECT d2.id
          FROM deployments d2
          WHERE d2.tenant_code = ?
            AND d2.app_code = pa.app_code
          ORDER BY CASE WHEN d2.status = 'active' THEN 0 ELSE 1 END, d2.updated_at DESC, d2.id DESC
          LIMIT 1
        )
      LEFT JOIN license_deployments ld
        ON ld.id = (
          SELECT ld2.id
          FROM license_deployments ld2
          WHERE ld2.deployment_id = d.id
          ORDER BY CASE WHEN ld2.status = 'active' THEN 0 ELSE 1 END, ld2.effective_from DESC, ld2.id DESC
          LIMIT 1
        )
      LEFT JOIN licenses l ON l.id = ld.license_id
      LEFT JOIN platform_app_manifests m
        ON m.id = COALESCE(
          pa.latest_manifest_id,
          (
            SELECT pam2.id
            FROM platform_app_manifests pam2
            WHERE pam2.app_code = pa.app_code
              AND pam2.status = 'active'
            ORDER BY pam2.created_at DESC, pam2.id DESC
            LIMIT 1
          )
        )
       AND m.app_code = pa.app_code`
}

function subscriptionJoinParams(tenantCode: string, options: SubscriptionQueryOptions = {}) {
  return options.planScoped
    ? [tenantCode, tenantCode, tenantCode]
    : [tenantCode, tenantCode]
}

function entitlementSelectColumns(options: SubscriptionQueryOptions = {}) {
  return options.planScoped
    ? `tscope.plan_code AS entitlement_plan_code,
        ppa.role_in_plan,
        ppa.sort_order AS plan_sort_order,`
    : `NULL AS entitlement_plan_code,
        NULL AS role_in_plan,
        NULL AS plan_sort_order,`
}

function subscriptionOrderSql(options: SubscriptionQueryOptions = {}) {
  if (options.planScoped) {
    return `ORDER BY CASE WHEN ppa.role_in_plan = 'core' THEN 0 ELSE 1 END,
             ppa.sort_order ASC,
             pa.app_code ASC`
  }

  return `ORDER BY CASE WHEN pa.service_role = 'supporting_service' THEN 0 ELSE 1 END,
           pa.app_code ASC`
}

export async function listSubscriptions(tenantCode: string, options: SubscriptionQueryOptions = {}) {
  const page = Math.max(1, Number(options.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const { whereSql, params } = buildListWhere(options)
  const joins = subscriptionJoins(options)
  const joinParams = subscriptionJoinParams(tenantCode, options)
  const entitlementColumns = entitlementSelectColumns(options)
  const orderSql = subscriptionOrderSql(options)

  const rows = await queryRows<SubscriptionRow[]>(
    `SELECT
        pa.id AS application_id,
        pa.app_code,
        pa.app_name,
        pa.description AS app_description,
        pa.icon AS app_icon,
        pa.app_type,
        pa.runtime_mode,
        pa.service_role,
        pa.auth_mode,
        pa.status AS app_status,
        s.id AS subscription_id,
        s.subscription_no,
        s.plan_code AS subscription_plan_code,
        s.status AS subscription_status,
        s.started_at AS subscription_started_at,
        ${entitlementColumns}
        d.id AS deployment_id,
        d.deployment_code,
        d.deployment_name,
        d.deployment_mode,
        d.status AS deployment_status,
        d.license_status AS deployment_license_status,
        d.connectivity_status AS deployment_connectivity_status,
        d.version_status AS deployment_version_status,
        d.site_id AS deployment_site_id,
        d.base_path AS deployment_base_path,
        d.api_base AS deployment_api_base,
        d.route_source AS deployment_route_source,
        d.runtime_endpoint AS deployment_runtime_endpoint,
        d.callback_url AS deployment_callback_url,
        d.last_heartbeat_at,
        ld.status AS license_deployment_status,
        l.id AS license_id,
        l.license_code,
        l.plan_code,
        l.status AS license_status,
        l.issued_at,
        l.expires_at,
        l.grace_until,
        m.manifest_seq AS manifest_seq,
        m.created_at AS manifest_created_at
      ${joins}
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?`,
    [...joinParams, ...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     ${joins}
     ${whereSql}`,
    [...joinParams, ...params]
  )

  return {
    items: rows.map(row => mapSubscription(row, tenantCode)),
    total: totalRow?.total || 0,
    page,
    pageSize
  }
}

export async function getSubscriptionByAppCode(tenantCode: string, appCode: string) {
  const joins = subscriptionJoins()

  const row = await queryRow<SubscriptionRow>(
    `SELECT
        pa.id AS application_id,
        pa.app_code,
        pa.app_name,
        pa.description AS app_description,
        pa.icon AS app_icon,
        pa.app_type,
        pa.runtime_mode,
        pa.service_role,
        pa.auth_mode,
        pa.status AS app_status,
        s.id AS subscription_id,
        s.subscription_no,
        s.plan_code AS subscription_plan_code,
        s.status AS subscription_status,
        s.started_at AS subscription_started_at,
        NULL AS entitlement_plan_code,
        NULL AS role_in_plan,
        NULL AS plan_sort_order,
        d.id AS deployment_id,
        d.deployment_code,
        d.deployment_name,
        d.deployment_mode,
        d.status AS deployment_status,
        d.license_status AS deployment_license_status,
        d.connectivity_status AS deployment_connectivity_status,
        d.version_status AS deployment_version_status,
        d.site_id AS deployment_site_id,
        d.base_path AS deployment_base_path,
        d.api_base AS deployment_api_base,
        d.route_source AS deployment_route_source,
        d.runtime_endpoint AS deployment_runtime_endpoint,
        d.callback_url AS deployment_callback_url,
        d.last_heartbeat_at,
        ld.status AS license_deployment_status,
        l.id AS license_id,
        l.license_code,
        l.plan_code,
        l.status AS license_status,
        l.issued_at,
        l.expires_at,
        l.grace_until,
        m.manifest_seq AS manifest_seq,
        m.created_at AS manifest_created_at
      ${joins}
      WHERE pa.app_code = ?
      LIMIT 1`,
    [tenantCode, tenantCode, appCode]
  )

  return row ? mapSubscription(row, tenantCode) : null
}
