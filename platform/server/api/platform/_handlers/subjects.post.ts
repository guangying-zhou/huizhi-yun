import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  user_id: number | null
  subject_type: string
  subject_code: string
  display_name: string | null
  external_ref: string | null
  parent_subject_id: number | null
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'committee', 'job'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

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

async function loadSubject(id: number) {
  return queryRow<SubjectRow>(
    `SELECT ts.id, ts.tenant_code,
            CASE WHEN ts.subject_type = 'user' THEN ts.id ELSE NULL END AS user_id,
            ts.subject_type, ts.subject_code, ts.display_name, ts.external_ref,
            ts.parent_subject_id, ts.status, ts.created_at, ts.updated_at
     FROM tenant_subjects ts
     WHERE ts.id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const subjectType = requireAllowed(requireString(body.subjectType, 'subjectType'), 'subjectType', ALLOWED_SUBJECT_TYPES)
  const subjectCode = requireString(body.subjectCode, 'subjectCode')
  const displayName = requireString(body.displayName, 'displayName')
  const externalRef = normalizeNullableString(body.externalRef)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const parentSubjectId = body.parentSubjectId === undefined || body.parentSubjectId === null || body.parentSubjectId === ''
    ? null
    : Number(body.parentSubjectId)

  const tenant = await queryRow<RowDataPacket>(
    `SELECT id FROM tenants WHERE tenant_code = ? LIMIT 1`,
    [tenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  if (parentSubjectId !== null && (!Number.isInteger(parentSubjectId) || parentSubjectId <= 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'parentSubjectId is invalid'
    })
  }

  if (parentSubjectId !== null) {
    const parent = await queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_subjects
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1`,
      [parentSubjectId, tenantCode]
    )

    if (!parent) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `parent subject not found: parentSubjectId=${parentSubjectId}`
      })
    }
  }

  const existing = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_subjects
     WHERE tenant_code = ?
       AND subject_type = ?
       AND subject_code = ?
     LIMIT 1`,
    [tenantCode, subjectType, subjectCode]
  )

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `subject already exists: tenantCode=${tenantCode}, subjectType=${subjectType}, subjectCode=${subjectCode}`
    })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO tenant_subjects
      (tenant_code, subject_type, subject_code, display_name, external_ref, parent_subject_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tenantCode, subjectType, subjectCode, displayName, externalRef, parentSubjectId, status]
  )

  const subject = await loadSubject(result.insertId)
  if (!subject) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created subject'
    })
  }

  return ok({
    id: subject.id,
    tenantCode: subject.tenant_code,
    userId: subject.user_id,
    subjectType: subject.subject_type,
    subjectCode: subject.subject_code,
    displayName: subject.display_name || subject.subject_code,
    externalRef: subject.external_ref,
    parentSubjectId: subject.parent_subject_id,
    status: subject.status,
    createdAt: subject.created_at,
    updatedAt: subject.updated_at
  })
})
