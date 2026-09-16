import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { TransactionExecutor } from '~~/server/utils/db'

interface RoleConstraintRow extends RowDataPacket {
  id: number
  role_code: string
  status: string
  max_active_assignments: number | null
  subject_type_constraint: string | null
}

interface AssignmentIdRow extends RowDataPacket {
  id: number
}

interface RevisionRow extends RowDataPacket {
  revision: number
}

export interface RoleAssignmentConstraintInput {
  tenantCode: string
  roleId: number
  subjectType: string
  assignmentStatus: string
  startsAt: string | null
  expiredAt: string | null
  excludeAssignmentId?: number | null
}

function roleConstraintError(code: string, message: string, data?: Record<string, unknown>) {
  return createError({
    statusCode: 409,
    statusMessage: 'Role Assignment Constraint',
    message,
    data: {
      code,
      ...data
    }
  })
}

export async function lockRoleAssignmentConstraint(
  tx: TransactionExecutor,
  tenantCode: string,
  roleId: number
) {
  const role = await tx.queryRow<RoleConstraintRow>(
    `SELECT id, role_code, status, max_active_assignments, subject_type_constraint
     FROM tenant_roles
     WHERE tenant_code = ?
       AND id = ?
     FOR UPDATE`,
    [tenantCode, roleId]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'tenant role not found'
    })
  }

  return role
}

export async function assertRoleAssignmentConstraints(
  tx: TransactionExecutor,
  input: RoleAssignmentConstraintInput
) {
  const role = await lockRoleAssignmentConstraint(tx, input.tenantCode, input.roleId)
  if (role.status !== 'active') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'active tenant role not found'
    })
  }
  const subjectTypeConstraint = String(role.subject_type_constraint || '').trim()

  if (subjectTypeConstraint && subjectTypeConstraint !== input.subjectType) {
    throw roleConstraintError(
      'role_subject_type_mismatch',
      `${role.role_code} can only be assigned to ${subjectTypeConstraint} subjects`,
      {
        roleCode: role.role_code,
        requiredSubjectType: subjectTypeConstraint,
        actualSubjectType: input.subjectType
      }
    )
  }

  if (input.assignmentStatus !== 'active') {
    return role
  }

  const maxActiveAssignments = Number(role.max_active_assignments || 0)
  if (!Number.isInteger(maxActiveAssignments) || maxActiveAssignments <= 0) {
    return role
  }

  const overlapping = await tx.queryRows<AssignmentIdRow[]>(
    `SELECT tsr.id
     FROM tenant_subject_roles tsr
     WHERE tsr.tenant_code = ?
       AND tsr.role_id = ?
       AND tsr.status = 'active'
       AND (? IS NULL OR tsr.id <> ?)
       AND (? IS NULL OR tsr.starts_at IS NULL OR tsr.starts_at < ?)
       AND (tsr.expired_at IS NULL OR tsr.expired_at > COALESCE(?, UTC_TIMESTAMP()))
     ORDER BY tsr.id
     FOR UPDATE`,
    [
      input.tenantCode,
      input.roleId,
      input.excludeAssignmentId || null,
      input.excludeAssignmentId || null,
      input.expiredAt,
      input.expiredAt,
      input.startsAt
    ]
  )

  if (overlapping.length >= maxActiveAssignments) {
    throw roleConstraintError(
      'role_assignment_capacity_exceeded',
      `${role.role_code} already has the maximum number of overlapping active holders`,
      {
        roleCode: role.role_code,
        maxActiveAssignments,
        overlappingAssignmentIds: overlapping.map(item => item.id)
      }
    )
  }

  return role
}

export async function bumpRoleHolderRevision(
  tx: TransactionExecutor,
  tenantCode: string,
  roleId: number
) {
  await tx.execute<ResultSetHeader>(
    `INSERT INTO tenant_role_holder_revisions
      (tenant_code, role_id, revision, updated_at)
     VALUES (?, ?, 1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       revision = revision + 1,
       updated_at = UTC_TIMESTAMP()`,
    [tenantCode, roleId]
  )

  const row = await tx.queryRow<RevisionRow>(
    `SELECT revision
     FROM tenant_role_holder_revisions
     WHERE tenant_code = ?
       AND role_id = ?
     LIMIT 1`,
    [tenantCode, roleId]
  )

  return Number(row?.revision || 0)
}
