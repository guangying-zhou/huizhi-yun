import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { evaluateSubjectRoleAssignmentConflicts } from '~~/server/utils/staticRoleConflicts'
import { materializeSystemRole } from '~~/server/utils/tenantSystemRoles'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_type: string
  subject_code: string
  display_name: string | null
}

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  app_code: string | null
  is_assignable: number
  status: string
}

interface AssignmentRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_id: number
  role_id: number
  source_type: string
  source_id: string | null
  assignment_kind: string
  reason: string | null
  granted_by_uid: string | null
  granted_at: string
  starts_at: string | null
  expired_at: string | null
  status: string
}

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'job'])
const ALLOWED_SOURCE_TYPES = new Set(['manual', 'system', 'template', 'import'])
const ALLOWED_ASSIGNMENT_KINDS = new Set(['position', 'duty', 'temporary', 'inherited', 'privileged'])
const ALLOWED_ASSIGNMENT_STATUS = new Set(['active', 'suspended', 'revoked'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

function normalizeSqlDateTime(value: unknown, field: string) {
  const rawValue = normalizeNullableString(value)
  if (!rawValue) {
    return null
  }

  const date = new Date(rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be a valid datetime`
    })
  }

  return date.toISOString().slice(0, 19).replace('T', ' ')
}

async function loadSubject(input: {
  tenantCode: string
  subjectType: string
  subjectId?: number | null
  subjectCode?: string | null
}) {
  if (input.subjectId) {
    return queryRow<SubjectRow>(
      `SELECT id, tenant_code, subject_type, subject_code, display_name
       FROM tenant_subjects
       WHERE id = ?
         AND tenant_code = ?
         AND subject_type = ?
       LIMIT 1`,
      [input.subjectId, input.tenantCode, input.subjectType]
    )
  }

  return queryRow<SubjectRow>(
    `SELECT id, tenant_code, subject_type, subject_code, display_name
     FROM tenant_subjects
     WHERE tenant_code = ?
       AND subject_type = ?
       AND subject_code = ?
     LIMIT 1`,
    [input.tenantCode, input.subjectType, input.subjectCode || '']
  )
}

async function loadRole(input: {
  tenantCode: string
  roleId?: number | null
  roleCode?: string | null
}) {
  if (input.roleId) {
    return queryRow<RoleRow>(
      `SELECT id, tenant_code, role_code, role_name, app_code, is_assignable, status
       FROM tenant_roles
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1`,
      [input.roleId, input.tenantCode]
    )
  }

  return queryRow<RoleRow>(
    `SELECT id, tenant_code, role_code, role_name, app_code, is_assignable, status
     FROM tenant_roles
     WHERE tenant_code = ?
       AND role_code = ?
     LIMIT 1`,
    [input.tenantCode, input.roleCode || '']
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const subjectType = requireAllowed(requireString(body.subjectType, 'subjectType'), 'subjectType', ALLOWED_SUBJECT_TYPES)
  const subjectId = Number(body.subjectId || 0)
  const subjectCode = normalizeNullableString(body.subjectCode)
  const roleId = Number(body.roleId || 0)
  const roleCode = normalizeNullableString(body.roleCode)
  const systemRoleCode = normalizeNullableString(body.systemRoleCode)
  const sourceType = requireAllowed(normalizeNullableString(body.sourceType) || 'manual', 'sourceType', ALLOWED_SOURCE_TYPES)
  const sourceId = normalizeNullableString(body.sourceId)
  const assignmentKind = requireAllowed(normalizeNullableString(body.assignmentKind) || 'duty', 'assignmentKind', ALLOWED_ASSIGNMENT_KINDS)
  const assignmentStatus = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_ASSIGNMENT_STATUS)
  const reason = normalizeNullableString(body.reason)
  const grantedAt = normalizeSqlDateTime(body.grantedAt, 'grantedAt')
  const startsAt = normalizeSqlDateTime(body.startsAt, 'startsAt')
  const expiredAt = normalizeSqlDateTime(body.expiredAt, 'expiredAt')
  const grantedByUid = String(event.context.platformUid || '').trim() || null
  let resolvedRoleId = Number.isInteger(roleId) && roleId > 0 ? roleId : 0

  if ((!Number.isInteger(subjectId) || subjectId <= 0) && !subjectCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'subjectId or subjectCode is required'
    })
  }

  if (!resolvedRoleId && !roleCode && !systemRoleCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'roleId, roleCode, or systemRoleCode is required'
    })
  }

  const subject = await loadSubject({
    tenantCode,
    subjectType,
    subjectId: Number.isInteger(subjectId) && subjectId > 0 ? subjectId : null,
    subjectCode
  })

  if (!subject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'subject not found'
    })
  }

  if (!resolvedRoleId && !roleCode && systemRoleCode) {
    const materialized = await withTransaction(async (tx) => {
      return materializeSystemRole(tx, {
        tenantCode,
        systemRoleCode
      })
    })

    resolvedRoleId = Number(materialized.tenantRole?.id || 0)
    if (!resolvedRoleId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `failed to materialize system role before assignment: systemRoleCode=${systemRoleCode}`
      })
    }
  }

  const role = await loadRole({
    tenantCode,
    roleId: resolvedRoleId || null,
    roleCode
  })

  if (!role || role.status !== 'active' || !role.is_assignable) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'active assignable role not found'
    })
  }

  const roleConflictEvaluation = await evaluateSubjectRoleAssignmentConflicts({
    tenantCode,
    subjectId: subject.id,
    candidateRole: {
      roleId: role.id,
      roleCode: role.role_code,
      roleName: role.role_name
    },
    assignmentStatus,
    startsAt,
    expiredAt
  })

  if (roleConflictEvaluation.blockingConflicts.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Role Conflict',
      message: roleConflictEvaluation.blockingConflicts[0]?.message || 'role conflict detected',
      data: {
        roleConflicts: roleConflictEvaluation.blockingConflicts
      }
    })
  }

  const assignmentId = await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_subject_roles
        (tenant_code, subject_id, role_id, source_type, assignment_kind, source_id, reason, granted_by_uid, granted_at, starts_at, expired_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         assignment_kind = VALUES(assignment_kind),
         reason = VALUES(reason),
         granted_by_uid = VALUES(granted_by_uid),
         granted_at = VALUES(granted_at),
         starts_at = VALUES(starts_at),
         expired_at = VALUES(expired_at),
         status = VALUES(status)`,
      [
        tenantCode,
        subject.id,
        role.id,
        sourceType,
        assignmentKind,
        sourceId,
        reason,
        grantedByUid,
        grantedAt,
        startsAt,
        expiredAt,
        assignmentStatus
      ]
    )

    const row = await tx.queryRow<AssignmentRow>(
      `SELECT id, tenant_code, subject_id, role_id, source_type, source_id,
              assignment_kind, reason, granted_by_uid, granted_at, starts_at, expired_at, status
       FROM tenant_subject_roles
       WHERE tenant_code = ?
         AND subject_id = ?
         AND role_id = ?
         AND source_type = ?
         AND source_id_key = IFNULL(?, '__NULL__')
       LIMIT 1`,
      [tenantCode, subject.id, role.id, sourceType, sourceId]
    )

    return row?.id || 0
  })

  return ok({
    id: assignmentId,
    tenantCode,
    subject: {
      id: subject.id,
      subjectType: subject.subject_type,
      subjectCode: subject.subject_code,
      displayName: subject.display_name || subject.subject_code
    },
    role: {
      id: role.id,
      roleCode: role.role_code,
      roleName: role.role_name,
      appCode: role.app_code
    },
    sourceType,
    sourceId,
    assignmentKind,
    reason,
    status: assignmentStatus,
    grantedByUid,
    grantedAt,
    startsAt,
    expiredAt,
    roleConflictWarnings: roleConflictEvaluation.warnings
  })
})
