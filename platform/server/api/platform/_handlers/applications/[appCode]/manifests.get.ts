import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface ManifestRow extends RowDataPacket {
  id: number
  app_code: string
  manifest_seq: number
  manifest_hash: string
  manifest_json: unknown
  status: string
  created_at: string
  release_versions: string | null
  resource_count: number
  action_count: number
  is_latest: number
}

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')

  const items = await queryRows<ManifestRow[]>(
    `SELECT pam.id,
            pam.app_code,
            pam.manifest_seq,
            pam.manifest_hash,
            pam.manifest_json,
            pam.status,
            pam.created_at,
            GROUP_CONCAT(DISTINCT par.release_version ORDER BY par.created_at DESC SEPARATOR ', ') AS release_versions,
            COUNT(DISTINCT mr.id) AS resource_count,
            COUNT(DISTINCT mra.id) AS action_count,
            CASE WHEN pa.latest_manifest_id = pam.id
              OR lr.manifest_id = pam.id
            THEN 1 ELSE 0 END AS is_latest
     FROM platform_app_manifests pam
     INNER JOIN platform_applications pa
       ON pa.app_code = pam.app_code
     LEFT JOIN platform_app_releases lr
       ON lr.id = pa.latest_release_id
      AND lr.app_code = pa.app_code
     LEFT JOIN platform_app_releases par
       ON par.manifest_id = pam.id
      AND par.app_code = pam.app_code
     LEFT JOIN platform_app_manifest_resources mr
       ON mr.manifest_id = pam.id
      AND mr.app_code = pam.app_code
      AND mr.status = 'active'
     LEFT JOIN platform_app_manifest_resource_actions mra
       ON mra.manifest_id = pam.id
      AND mra.app_code = pam.app_code
      AND mra.status = 'active'
     WHERE pam.app_code = ?
     GROUP BY pam.id,
              pam.app_code,
              pam.manifest_seq,
              pam.manifest_hash,
              pam.manifest_json,
              pam.status,
              pam.created_at,
              pa.latest_manifest_id,
              lr.manifest_id
     ORDER BY manifest_seq DESC, id DESC`,
    [appCode]
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: null,
      appCode: item.app_code,
      manifestSeq: item.manifest_seq,
      manifestHash: item.manifest_hash,
      manifestJson: typeof item.manifest_json === 'string' ? JSON.parse(item.manifest_json) : item.manifest_json,
      status: item.status,
      createdAt: item.created_at,
      releaseVersions: item.release_versions
        ? item.release_versions.split(',').map(value => value.trim()).filter(Boolean)
        : [],
      resourceCount: Number(item.resource_count || 0),
      actionCount: Number(item.action_count || 0),
      isLatest: Boolean(item.is_latest)
    }))
  })
})
