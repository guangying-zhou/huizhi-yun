import type { RowDataPacket } from 'mysql2/promise'

type QueryExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
}

export interface AppReleaseRow extends RowDataPacket {
  id: number
  app_code: string
  release_version: string
  source_tag: string
  source_commit_sha: string | null
  manifest_id: number
  manifest_seq: number
  manifest_hash: string
  status: string
  bundle_uri: string | null
  bundle_hash: string | null
  bundle_size_bytes: number | null
  released_at: string | null
  created_at: string
  updated_at: string
  is_latest_released: number
  resource_count: number
  action_count: number
  missing_grant_action_count: number
  missing_actions_csv: string | null
}

export function mapReleaseRow(row: AppReleaseRow) {
  const missingActions = row.missing_actions_csv
    ? row.missing_actions_csv.split(',').map(item => item.trim()).filter(Boolean)
    : []

  return {
    id: row.id,
    appCode: row.app_code,
    releaseVersion: row.release_version,
    sourceTag: row.source_tag,
    sourceCommitSha: row.source_commit_sha,
    manifestId: row.manifest_id,
    manifestSeq: row.manifest_seq,
    manifestHash: row.manifest_hash,
    status: row.status,
    bundleUri: row.bundle_uri,
    bundleHash: row.bundle_hash,
    bundleSizeBytes: row.bundle_size_bytes,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isLatestReleased: Boolean(row.is_latest_released),
    resourceCount: Number(row.resource_count || 0),
    actionCount: Number(row.action_count || 0),
    missingGrantActionCount: Number(row.missing_grant_action_count || 0),
    missingActions
  }
}

function releaseSelect(whereSql: string) {
  return `SELECT par.id,
                 par.app_code,
                 par.release_version,
                 par.source_tag,
                 par.source_commit_sha,
                 par.manifest_id,
                 pam.manifest_seq,
                 pam.manifest_hash,
                 par.status,
                 par.bundle_uri,
                 par.bundle_hash,
                 par.bundle_size_bytes,
                 par.released_at,
                 par.created_at,
                 par.updated_at,
                 CASE WHEN pa.latest_release_id = par.id THEN 1 ELSE 0 END AS is_latest_released,
                 COUNT(DISTINCT mr.id) AS resource_count,
                 COUNT(DISTINCT mra.id) AS action_count,
                 COUNT(DISTINCT CASE
                   WHEN mra.requires_grant = 1
                    AND mra.status = 'active'
                    AND srp.id IS NULL
                   THEN mra.id
                   ELSE NULL
                 END) AS missing_grant_action_count,
                 GROUP_CONCAT(DISTINCT CASE
                   WHEN mra.requires_grant = 1
                    AND mra.status = 'active'
                    AND srp.id IS NULL
                   THEN mra.action_code
                   ELSE NULL
                 END ORDER BY mra.action_code SEPARATOR ',') AS missing_actions_csv
          FROM platform_app_releases par
          INNER JOIN platform_applications pa
            ON pa.app_code = par.app_code
          INNER JOIN platform_app_manifests pam
            ON pam.id = par.manifest_id
           AND pam.app_code = par.app_code
          LEFT JOIN platform_app_manifest_resources mr
            ON mr.manifest_id = par.manifest_id
           AND mr.app_code = par.app_code
           AND mr.status = 'active'
          LEFT JOIN platform_app_manifest_resource_actions mra
            ON mra.manifest_resource_id = mr.id
           AND mra.manifest_id = mr.manifest_id
           AND mra.app_code = mr.app_code
           AND mra.resource_code = mr.resource_code
           AND mra.status = 'active'
          LEFT JOIN platform_app_role_permissions srp
            ON srp.manifest_action_id = mra.id
          ${whereSql}
          GROUP BY par.id,
                   par.app_code,
                   par.release_version,
                   par.source_tag,
                   par.source_commit_sha,
                   par.manifest_id,
                   pam.manifest_seq,
                   pam.manifest_hash,
                   par.status,
                   par.bundle_uri,
                   par.bundle_hash,
                   par.bundle_size_bytes,
                   par.released_at,
                   par.created_at,
                   par.updated_at,
                   pa.latest_release_id`
}

export async function queryAppReleaseRows(executor: QueryExecutor, appCode: string) {
  return executor.queryRows<AppReleaseRow[]>(
    `${releaseSelect('WHERE par.app_code = ?')}
     ORDER BY par.created_at DESC, par.id DESC`,
    [appCode]
  )
}

export async function queryAppReleaseRow(executor: QueryExecutor, appCode: string, releaseId: number) {
  return executor.queryRow<AppReleaseRow>(
    `${releaseSelect('WHERE par.app_code = ? AND par.id = ?')}
     LIMIT 1`,
    [appCode, releaseId]
  )
}
