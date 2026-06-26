import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface ApplicationRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  callback_url: string | null
  logout_url: string | null
  repo_url: string | null
  app_type: string
  runtime_mode: string
  service_role: string
  auth_mode: string
  bundle_enabled: number
  sort_order: number
  latest_manifest_id: number | null
  latest_release_id: number | null
  latest_release_ref_id: number | null
  latest_release_version: string | null
  latest_release_status: string | null
  latest_manifest_seq: number | null
  latest_manifest_hash: string | null
  latest_registration_id: number | null
  last_manifest_registered_at: string | null
  last_manifest_review_status: string | null
  last_released_at: string | null
  subscriber_count: number
  active_deployment_count: number
  warning_deployment_count: number
  resource_count: number
  action_count: number
  status: string
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const status = normalizeNullableString(query.status)
  const appType = normalizeNullableString(query.appType)
  const appCode = normalizeNullableString(query.appCode)
  const serviceRole = normalizeNullableString(query.serviceRole)
  const releaseStatus = normalizeNullableString(query.releaseStatus)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (status) {
    where.push('pa.status = ?')
    params.push(status)
  }

  if (appType) {
    where.push('pa.app_type = ?')
    params.push(appType)
  }

  if (appCode) {
    where.push('pa.app_code = ?')
    params.push(appCode)
  }

  if (serviceRole) {
    where.push('pa.service_role = ?')
    params.push(serviceRole)
  }

  if (releaseStatus) {
    where.push('COALESCE(lr.status, lra.status) = ?')
    params.push(releaseStatus)
  }

  if (keyword) {
    where.push('(pa.app_code LIKE ? OR pa.app_name LIKE ? OR COALESCE(pa.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<ApplicationRow[]>(
    `SELECT pa.id, pa.app_code, pa.app_name, pa.description, pa.icon, pa.home_url, pa.callback_url, pa.logout_url, pa.repo_url,
            pa.app_type, pa.runtime_mode, pa.service_role, pa.auth_mode, pa.bundle_enabled, pa.sort_order,
            pa.latest_manifest_id,
            pa.latest_release_id,
            COALESCE(lr.id, lra.id) AS latest_release_ref_id,
            COALESCE(lr.release_version, lra.release_version) AS latest_release_version,
            COALESCE(lr.status, lra.status) AS latest_release_status,
            lm.manifest_seq AS latest_manifest_seq,
            lm.manifest_hash AS latest_manifest_hash, pa.latest_registration_id,
            pa.last_manifest_registered_at, pa.last_manifest_review_status, pa.last_released_at,
            COALESCE(sc.subscriber_count, 0) AS subscriber_count,
            COALESCE(dc.active_deployment_count, 0) AS active_deployment_count,
            COALESCE(dc.warning_deployment_count, 0) AS warning_deployment_count,
            COALESCE(rc.resource_count, 0) AS resource_count,
            COALESCE(ac.action_count, 0) AS action_count,
            pa.status, pa.created_at, pa.updated_at
     FROM platform_applications pa
     LEFT JOIN platform_app_releases lr
       ON lr.id = pa.latest_release_id
      AND lr.app_code = pa.app_code
     LEFT JOIN platform_app_releases lra
       ON lra.id = (
         SELECT par2.id
         FROM platform_app_releases par2
         WHERE par2.app_code = pa.app_code
         ORDER BY par2.created_at DESC, par2.id DESC
         LIMIT 1
       )
      AND lra.app_code = pa.app_code
     LEFT JOIN platform_app_manifests lm
       ON lm.id = COALESCE(lr.manifest_id, lra.manifest_id, pa.latest_manifest_id)
      AND lm.app_code = pa.app_code
     LEFT JOIN (
       SELECT app_code, COUNT(DISTINCT tenant_code) AS subscriber_count
       FROM subscriptions
       WHERE status = 'active'
       GROUP BY app_code
     ) sc ON sc.app_code = pa.app_code
     LEFT JOIN (
       SELECT app_code,
              COUNT(DISTINCT CASE WHEN status = 'active' THEN id ELSE NULL END) AS active_deployment_count,
              COUNT(DISTINCT CASE
                WHEN status = 'active'
                 AND (connectivity_status <> 'passed'
                  OR version_status IN ('drifted', 'incompatible')
                  OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)))
                THEN id
                ELSE NULL
              END) AS warning_deployment_count
       FROM deployments
       GROUP BY app_code
     ) dc ON dc.app_code = pa.app_code
     LEFT JOIN (
       SELECT manifest_id, app_code, COUNT(*) AS resource_count
       FROM platform_app_manifest_resources
       WHERE status = 'active'
       GROUP BY manifest_id, app_code
     ) rc ON rc.manifest_id = lm.id AND rc.app_code = pa.app_code
     LEFT JOIN (
       SELECT manifest_id, app_code, COUNT(*) AS action_count
       FROM platform_app_manifest_resource_actions
       WHERE status = 'active'
       GROUP BY manifest_id, app_code
     ) ac ON ac.manifest_id = lm.id AND ac.app_code = pa.app_code
     ${whereSql}
     ORDER BY pa.sort_order ASC, pa.app_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_applications pa
     LEFT JOIN platform_app_releases lr
       ON lr.id = pa.latest_release_id
      AND lr.app_code = pa.app_code
     LEFT JOIN platform_app_releases lra
       ON lra.id = (
         SELECT par2.id
         FROM platform_app_releases par2
         WHERE par2.app_code = pa.app_code
         ORDER BY par2.created_at DESC, par2.id DESC
         LIMIT 1
       )
      AND lra.app_code = pa.app_code
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: null,
      appCode: item.app_code,
      appName: item.app_name,
      description: item.description,
      icon: item.icon,
      homeUrl: item.home_url,
      callbackUrl: item.callback_url,
      logoutUrl: item.logout_url,
      repoUrl: item.repo_url,
      appType: item.app_type,
      runtimeMode: item.runtime_mode,
      serviceRole: item.service_role,
      authMode: item.auth_mode,
      bundleEnabled: Boolean(item.bundle_enabled),
      sortOrder: Number(item.sort_order || 0),
      status: item.status,
      latestManifestId: item.latest_manifest_id,
      latestReleaseId: item.latest_release_ref_id || item.latest_release_id,
      latestReleaseVersion: item.latest_release_version,
      latestReleaseStatus: item.latest_release_status,
      latestManifestSeq: item.latest_manifest_seq,
      latestManifestHash: item.latest_manifest_hash,
      latestRegistrationId: item.latest_registration_id,
      lastManifestRegisteredAt: item.last_manifest_registered_at,
      lastManifestReviewStatus: item.last_manifest_review_status,
      lastReleasedAt: item.last_released_at,
      subscriberCount: Number(item.subscriber_count || 0),
      activeDeploymentCount: Number(item.active_deployment_count || 0),
      warningDeploymentCount: Number(item.warning_deployment_count || 0),
      resourceCount: Number(item.resource_count || 0),
      actionCount: Number(item.action_count || 0),
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
