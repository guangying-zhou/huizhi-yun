import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface SubjectRoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_id: number
  subject_type: string
  subject_code: string
  subject_display_name: string | null
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  role_source: string
  source_type: string
  source_id: string | null
  assignment_kind: string
  reason: string | null
  granted_by_uid: string | null
  granted_at: string
  starts_at: string | null
  expired_at: string | null
  status: string
  active: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const subjectType = normalizeNullableString(query.subjectType)
  const subjectId = normalizeNullableString(query.subjectId)
  const roleId = normalizeNullableString(query.roleId)
  const appCode = normalizeNullableString(query.appCode)
  const includeExpired = normalizeNullableString(query.includeExpired) === 'true'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tsr.tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (!includeExpired) {
    where.push('tsr.status = \'active\'')
    where.push('(tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())')
    where.push('(tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())')
  }

  if (subjectType) {
    where.push('ts.subject_type = ?')
    params.push(subjectType)
  }

  if (subjectId) {
    where.push('tsr.subject_id = ?')
    params.push(Number(subjectId))
  }

  if (roleId) {
    where.push('tsr.role_id = ?')
    params.push(Number(roleId))
  }

  if (appCode) {
    where.push(`(
      tr.app_code = ?
      OR EXISTS (
        SELECT 1
        FROM tenant_role_app_role_maps tram_filter
        INNER JOIN platform_app_roles ar_filter
          ON ar_filter.role_code = tram_filter.app_role_code
         AND ar_filter.status = 'active'
        WHERE tram_filter.tenant_code = tr.tenant_code
          AND tram_filter.role_id = tr.id
          AND ar_filter.app_code = ?
      )
    )`)
    params.push(appCode)
    params.push(appCode)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<SubjectRoleRow[]>(
    `SELECT tsr.id,
            tsr.tenant_code,
            tsr.subject_id,
            ts.subject_type,
            ts.subject_code,
            ts.display_name AS subject_display_name,
            tsr.role_id,
            tr.role_code,
            tr.role_name,
            tr.role_type,
            tr.app_code,
            tr.source AS role_source,
            tsr.source_type,
            tsr.source_id,
            tsr.assignment_kind,
            tsr.reason,
            tsr.granted_by_uid,
            tsr.granted_at,
            tsr.starts_at,
            tsr.expired_at,
            tsr.status,
            CASE
              WHEN tsr.status = 'active'
               AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
               AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
              THEN 1 ELSE 0
            END AS active
     FROM tenant_subject_roles tsr
     INNER JOIN tenant_subjects ts
       ON ts.id = tsr.subject_id
      AND ts.tenant_code = tsr.tenant_code
     INNER JOIN tenant_roles tr
       ON tr.id = tsr.role_id
      AND tr.tenant_code = tsr.tenant_code
     ${whereSql}
     ORDER BY ts.subject_type ASC, ts.subject_code ASC, tr.role_code ASC, tsr.granted_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_subject_roles tsr
     INNER JOIN tenant_subjects ts
       ON ts.id = tsr.subject_id
      AND ts.tenant_code = tsr.tenant_code
     INNER JOIN tenant_roles tr
       ON tr.id = tsr.role_id
      AND tr.tenant_code = tsr.tenant_code
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      tenantCode: row.tenant_code,
      subjectId: row.subject_id,
      subjectType: row.subject_type,
      subjectCode: row.subject_code,
      subjectDisplayName: row.subject_display_name || row.subject_code,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      roleType: row.role_type,
      appCode: row.app_code,
      roleSource: row.role_source,
      sourceType: row.source_type,
      sourceId: row.source_id,
      assignmentKind: row.assignment_kind,
      reason: row.reason,
      grantedByUid: row.granted_by_uid,
      grantedAt: row.granted_at,
      startsAt: row.starts_at,
      expiredAt: row.expired_at,
      status: row.status,
      active: Boolean(row.active)
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
