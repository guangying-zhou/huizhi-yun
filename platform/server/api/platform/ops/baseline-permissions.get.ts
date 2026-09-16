import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import {
  collectConfiguredBaselinePermissions,
  isMissingBaselineGovernanceTableError
} from '~~/server/utils/policyBundleBaseline'
import { queryRows } from '~~/server/utils/db'

interface AvailablePermissionRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string | null
  action: string
  action_name: string | null
  action_code: string
}

interface ExcludedSubjectRow extends RowDataPacket {
  subject_code: string
  display_name: string | null
  reason: string | null
  status: string
}

interface AvailableExcludedSubjectRow extends RowDataPacket {
  subject_code: string
  display_name: string | null
  tenant_count: number
  status: string
}

async function loadAvailablePermissions() {
  return queryRows<AvailablePermissionRow[]>(
    `SELECT mra.app_code,
            mra.resource_code,
            mr.resource_name,
            mra.action,
            mra.action_name,
            mra.action_code
     FROM platform_app_manifest_resource_actions mra
     LEFT JOIN platform_app_manifest_resources mr
       ON mr.manifest_id = mra.manifest_id
      AND mr.app_code = mra.app_code
      AND mr.resource_code = mra.resource_code
     LEFT JOIN platform_applications pa ON pa.app_code = mra.app_code
     WHERE mra.status = 'active'
       AND mra.app_code <> 'collab'
       AND mra.manifest_id = COALESCE(
         pa.latest_manifest_id,
         (
           SELECT pam.id
           FROM platform_app_manifests pam
           WHERE pam.app_code = mra.app_code
             AND pam.status = 'active'
           ORDER BY pam.manifest_seq DESC, pam.id DESC
           LIMIT 1
         )
       )
     ORDER BY mra.app_code ASC, mra.resource_code ASC, mra.action ASC`
  )
}

async function loadExcludedSubjects() {
  try {
    return await queryRows<ExcludedSubjectRow[]>(
      `SELECT subject_code, display_name, reason, status
       FROM platform_baseline_excluded_subjects
       WHERE status = 'active'
       ORDER BY subject_code ASC`
    )
  } catch (error) {
    if (isMissingBaselineGovernanceTableError(error)) return []
    throw error
  }
}

async function loadAvailableExcludedSubjects() {
  return queryRows<AvailableExcludedSubjectRow[]>(
    `SELECT ts.subject_code,
            COALESCE(MAX(NULLIF(ts.display_name, '')), ts.subject_code) AS display_name,
            COUNT(DISTINCT ts.tenant_code) AS tenant_count,
            CASE
              WHEN SUM(CASE WHEN ts.status = 'active' THEN 1 ELSE 0 END) > 0 THEN 'active'
              ELSE MAX(ts.status)
            END AS status
       FROM tenant_subjects ts
      WHERE ts.subject_type = 'user'
        AND ts.subject_code <> ''
      GROUP BY ts.subject_code
      ORDER BY COALESCE(MAX(NULLIF(ts.display_name, '')), ts.subject_code) ASC, ts.subject_code ASC
      LIMIT 500`
  )
}

export default defineEventHandler(async () => {
  const [permissions, availablePermissions, excludedSubjects, availableExcludedSubjects] = await Promise.all([
    collectConfiguredBaselinePermissions(),
    loadAvailablePermissions(),
    loadExcludedSubjects(),
    loadAvailableExcludedSubjects()
  ])

  return ok({
    permissions,
    availablePermissions: availablePermissions.map(item => ({
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name,
      action: item.action,
      actionName: item.action_name,
      actionCode: item.action_code
    })),
    excludedSubjects: excludedSubjects.map(item => ({
      subjectCode: item.subject_code,
      displayName: item.display_name,
      reason: item.reason,
      status: item.status
    })),
    availableExcludedSubjects: availableExcludedSubjects.map(item => ({
      subjectCode: item.subject_code,
      displayName: item.display_name,
      tenantCount: Number(item.tenant_count || 0),
      status: item.status
    }))
  })
})
