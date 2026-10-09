import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export interface OffboardingAuthorizationExecutor {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface RevokeUserAuthorizationForOffboardingInput {
  tenantCode: string
  uid: string
  sourceApp: string
  operatorUid?: string | null
  reason?: string | null
  idempotencyKey?: string | null
}

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_type: string
  subject_code: string
  external_ref: string | null
  status: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function affectedRows(result: ResultSetHeader) {
  return Number(result.affectedRows || 0)
}

function requireNormalized(value: unknown, field: string) {
  const normalized = text(value)
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

async function writeLifecycleAudit(
  executor: OffboardingAuthorizationExecutor,
  input: RevokeUserAuthorizationForOffboardingInput,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  await executor.execute<ResultSetHeader>(
    `INSERT INTO tenant_audit_logs
      (tenant_code, operator_uid, target_type, target_id, action, before_json, after_json, source, created_at)
     VALUES (?, ?, 'user', ?, 'authorization.user.offboard.from_people', CAST(? AS JSON), CAST(? AS JSON), ?, UTC_TIMESTAMP())`,
    [
      input.tenantCode,
      text(input.operatorUid) || null,
      input.uid,
      JSON.stringify(before),
      JSON.stringify(after),
      'people'
    ]
  )
}

export async function revokeUserAuthorizationForOffboarding(
  executor: OffboardingAuthorizationExecutor,
  input: RevokeUserAuthorizationForOffboardingInput
) {
  const tenantCode = requireNormalized(input.tenantCode, 'tenantCode')
  const uid = requireNormalized(input.uid, 'uid')
  const sourceApp = text(input.sourceApp)

  if (sourceApp !== 'people') {
    throw new Error('Only People lifecycle facts may trigger user authorization offboarding.')
  }

  const subject = await executor.queryRow<SubjectRow>(
    `SELECT id, tenant_code, subject_type, subject_code, external_ref, status
       FROM tenant_subjects
      WHERE tenant_code = ?
        AND subject_type = 'user'
        AND (subject_code = ? OR external_ref = ?)
      LIMIT 1`,
    [tenantCode, uid, uid]
  )

  if (!subject) {
    const result = {
      tenantCode,
      uid,
      subjectFound: false,
      subjectDisabled: false,
      revokedAssignments: 0,
      disabledAssignmentScopes: 0,
      disabledTemplateBindings: 0,
      disabledTemplateOverrides: 0,
      inactiveMemberships: 0,
      idempotencyKey: text(input.idempotencyKey) || null
    }

    await writeLifecycleAudit(
      executor,
      { ...input, tenantCode, uid },
      { subjectFound: false, sourceApp, reason: text(input.reason) || null },
      result
    )

    return result
  }

  const assignmentScopes = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_subject_role_scopes srs
       INNER JOIN tenant_subject_roles tsr
          ON tsr.id = srs.assignment_id
         AND tsr.tenant_code = srs.tenant_code
        SET srs.status = 'disabled',
            srs.updated_at = UTC_TIMESTAMP()
      WHERE srs.tenant_code = ?
        AND tsr.subject_id = ?
        AND srs.status = 'active'`,
    [tenantCode, subject.id]
  )

  const assignments = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_subject_roles
        SET status = 'revoked',
            expired_at = COALESCE(expired_at, UTC_TIMESTAMP())
      WHERE tenant_code = ?
        AND subject_id = ?
        AND status <> 'revoked'`,
    [tenantCode, subject.id]
  )

  const templateBindings = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_template_bindings
        SET status = 'disabled',
            end_at = COALESCE(end_at, UTC_TIMESTAMP()),
            updated_by_uid = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE tenant_code = ?
        AND subject_type = 'user'
        AND subject_id = ?
        AND status = 'active'`,
    [text(input.operatorUid) || null, tenantCode, subject.id]
  )

  const templateOverrides = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_template_overrides
        SET status = 'disabled',
            updated_by_uid = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE tenant_code = ?
        AND subject_type = 'user'
        AND subject_id = ?
        AND status = 'active'`,
    [text(input.operatorUid) || null, tenantCode, subject.id]
  )

  const memberships = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_subject_memberships
        SET status = 'inactive',
            updated_at = UTC_TIMESTAMP()
      WHERE tenant_code = ?
        AND subject_id = ?
        AND status = 'active'`,
    [tenantCode, subject.id]
  )

  const disabledSubject = await executor.execute<ResultSetHeader>(
    `UPDATE tenant_subjects
        SET status = 'disabled',
            updated_at = UTC_TIMESTAMP()
      WHERE tenant_code = ?
        AND id = ?
        AND status <> 'disabled'`,
    [tenantCode, subject.id]
  )

  const result = {
    tenantCode,
    uid,
    subjectFound: true,
    subjectId: subject.id,
    previousSubjectStatus: subject.status,
    subjectDisabled: affectedRows(disabledSubject) > 0 || subject.status === 'disabled',
    revokedAssignments: affectedRows(assignments),
    disabledAssignmentScopes: affectedRows(assignmentScopes),
    disabledTemplateBindings: affectedRows(templateBindings),
    disabledTemplateOverrides: affectedRows(templateOverrides),
    inactiveMemberships: affectedRows(memberships),
    idempotencyKey: text(input.idempotencyKey) || null
  }

  await writeLifecycleAudit(
    executor,
    { ...input, tenantCode, uid },
    {
      subjectFound: true,
      subjectId: subject.id,
      subjectCode: subject.subject_code,
      subjectStatus: subject.status,
      sourceApp,
      reason: text(input.reason) || null
    },
    result
  )

  return result
}
