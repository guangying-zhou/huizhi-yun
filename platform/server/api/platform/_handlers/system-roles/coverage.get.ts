import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface CoverageRow extends RowDataPacket {
  app_code: string
  app_name: string
  manifest_id: number
  manifest_seq: number
  resource_code: string
  resource_name: string
  action: string
  action_code: string
  manifest_action_id: number
  covered_role_count: number
  covering_roles_csv: string | null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = normalizeNullableString(query.appCode)
  const onlyMissing = normalizeNullableString(query.onlyMissing) !== 'false'
  const params: Array<string | number> = []
  const where = [
    'pa.status <> \'deleted\'',
    'mr.status = \'active\'',
    'mra.status = \'active\'',
    'mra.requires_grant = 1'
  ]

  if (appCode) {
    where.push('pa.app_code = ?')
    params.push(appCode)
  }

  const rows = await queryRows<CoverageRow[]>(
    `SELECT pa.app_code,
            pa.app_name,
            pam.id AS manifest_id,
            pam.manifest_seq,
            mr.resource_code,
            mr.resource_name,
            mra.action,
            mra.action_code,
            mra.id AS manifest_action_id,
            COUNT(DISTINCT psr.id) AS covered_role_count,
            GROUP_CONCAT(DISTINCT psr.role_code ORDER BY psr.role_code SEPARATOR ',') AS covering_roles_csv
     FROM platform_applications pa
     INNER JOIN platform_app_manifests pam
       ON pam.id = COALESCE(
         (SELECT par.manifest_id
          FROM platform_app_releases par
          WHERE par.id = pa.latest_release_id
            AND par.app_code = pa.app_code
          LIMIT 1),
         pa.latest_manifest_id
       )
      AND pam.app_code = pa.app_code
     INNER JOIN platform_app_manifest_resources mr
       ON mr.manifest_id = pam.id
      AND mr.app_code = pam.app_code
     INNER JOIN platform_app_manifest_resource_actions mra
       ON mra.manifest_resource_id = mr.id
      AND mra.manifest_id = mr.manifest_id
      AND mra.app_code = mr.app_code
      AND mra.resource_code = mr.resource_code
     LEFT JOIN platform_app_role_permissions psrp
       ON psrp.manifest_action_id = mra.id
     LEFT JOIN platform_app_roles psr
       ON psr.id = psrp.app_role_id
      AND psr.status = 'active'
     WHERE ${where.join(' AND ')}
     GROUP BY pa.app_code,
              pa.app_name,
              pam.id,
              pam.manifest_seq,
              mr.resource_code,
              mr.resource_name,
              mra.action,
              mra.action_code,
              mra.id
     ${onlyMissing ? 'HAVING covered_role_count = 0' : ''}
     ORDER BY pa.app_code ASC, mr.sort_order ASC, mr.resource_code ASC, mra.sort_order ASC, mra.action ASC`,
    params
  )

  const byApp = new Map<string, {
    appCode: string
    appName: string
    manifestId: number
    manifestSeq: number
    actionCount: number
    missingCount: number
  }>()

  for (const row of rows) {
    if (!byApp.has(row.app_code)) {
      byApp.set(row.app_code, {
        appCode: row.app_code,
        appName: row.app_name,
        manifestId: row.manifest_id,
        manifestSeq: row.manifest_seq,
        actionCount: 0,
        missingCount: 0
      })
    }

    const summary = byApp.get(row.app_code)!
    summary.actionCount += 1
    if (Number(row.covered_role_count || 0) === 0) {
      summary.missingCount += 1
    }
  }

  return ok({
    items: rows.map(row => ({
      appCode: row.app_code,
      appName: row.app_name,
      manifestId: row.manifest_id,
      manifestSeq: row.manifest_seq,
      resourceCode: row.resource_code,
      resourceName: row.resource_name,
      action: row.action,
      actionCode: row.action_code,
      manifestActionId: row.manifest_action_id,
      coveredRoleCount: Number(row.covered_role_count || 0),
      coveringRoles: row.covering_roles_csv
        ? row.covering_roles_csv.split(',').map(item => item.trim()).filter(Boolean)
        : []
    })),
    summary: Array.from(byApp.values()),
    total: rows.length
  })
})
