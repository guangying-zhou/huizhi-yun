import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { bumpRoleHolderRevision } from '~~/server/utils/roleAssignmentConstraints'
import { requireTenantOwnerForTenantAdmin } from '~~/server/utils/tenantAdminAccess'

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  status: string
  is_assignable: number
  max_active_assignments: number | null
  subject_type_constraint: string | null
}

interface SubjectRow extends RowDataPacket {
  id: number
  subject_code: string
  display_name: string | null
}

interface HolderRow extends RowDataPacket {
  assignment_id: number
  subject_code: string
  display_name: string | null
}

interface RevisionRow extends RowDataPacket {
  revision: number
}

function parseExpectedRevision(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'expectedRevision must be a non-negative integer'
    })
  }
  return revision
}

export default defineEventHandler(async (event) => {
  requireTenantOwnerForTenantAdmin(event, 'only tenant owner can replace company role holders')
  const roleCode = String(getRouterParam(event, 'roleCode') || '').trim()
  if (!roleCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'roleCode is required'
    })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const subjectCode = requireString(body.subjectCode, 'subjectCode')
  const reason = normalizeNullableString(body.reason)
  const expectedRevision = parseExpectedRevision(body.expectedRevision)
  const grantedByUid = String(event.context.platformUid || '').trim() || null

  const result = await withTransaction(async (tx) => {
    const role = await tx.queryRow<RoleRow>(
      `SELECT id, role_code, role_name, status, is_assignable,
              max_active_assignments, subject_type_constraint
       FROM tenant_roles
       WHERE tenant_code = ?
         AND role_code = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantCode, roleCode]
    )

    if (
      !role
      || role.status !== 'active'
      || !role.is_assignable
      || Number(role.max_active_assignments || 0) !== 1
      || role.subject_type_constraint !== 'user'
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: 'role does not support atomic single-user holder replacement'
      })
    }

    const revisionRow = await tx.queryRow<RevisionRow>(
      `SELECT revision
       FROM tenant_role_holder_revisions
       WHERE tenant_code = ?
         AND role_id = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantCode, role.id]
    )
    const currentRevision = Number(revisionRow?.revision || 0)
    if (expectedRevision !== null && expectedRevision !== currentRevision) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: 'role holder revision changed',
        data: {
          code: 'role_holder_revision_conflict',
          expectedRevision,
          currentRevision
        }
      })
    }

    const subject = await tx.queryRow<SubjectRow>(
      `SELECT id, subject_code, display_name
       FROM tenant_subjects
       WHERE tenant_code = ?
         AND subject_type = 'user'
         AND subject_code = ?
         AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [tenantCode, subjectCode]
    )
    if (!subject) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: 'active user subject not found'
      })
    }

    const previousHolders = await tx.queryRows<HolderRow[]>(
      `SELECT tsr.id AS assignment_id, subject.subject_code, subject.display_name
       FROM tenant_subject_roles tsr
       INNER JOIN tenant_subjects subject
         ON subject.id = tsr.subject_id
        AND subject.tenant_code = tsr.tenant_code
       WHERE tsr.tenant_code = ?
         AND tsr.role_id = ?
         AND tsr.status = 'active'
       ORDER BY tsr.id
       FOR UPDATE`,
      [tenantCode, role.id]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_subject_roles
       SET status = 'revoked',
           expired_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?
         AND role_id = ?
         AND status = 'active'`,
      [tenantCode, role.id]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_subject_roles
        (tenant_code, subject_id, role_id, source_type, assignment_kind, source_id,
         reason, granted_by_uid, granted_at, starts_at, expired_at, status)
       VALUES (?, ?, ?, 'manual', 'duty', 'company-role-holder',
               ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), NULL, 'active')
       ON DUPLICATE KEY UPDATE
         assignment_kind = 'duty',
         reason = VALUES(reason),
         granted_by_uid = VALUES(granted_by_uid),
         granted_at = UTC_TIMESTAMP(),
         starts_at = UTC_TIMESTAMP(),
         expired_at = NULL,
         status = 'active'`,
      [tenantCode, subject.id, role.id, reason, grantedByUid]
    )

    const revision = await bumpRoleHolderRevision(tx, tenantCode, role.id)
    return {
      role,
      subject,
      previousHolders,
      revision
    }
  })

  return ok({
    tenantCode,
    roleCode: result.role.role_code,
    roleName: result.role.role_name,
    revision: result.revision,
    holder: {
      uid: result.subject.subject_code,
      displayName: result.subject.display_name || result.subject.subject_code
    },
    previousHolders: result.previousHolders.map(holder => ({
      assignmentId: holder.assignment_id,
      uid: holder.subject_code,
      displayName: holder.display_name || holder.subject_code
    }))
  })
})
