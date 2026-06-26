import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface TemplateOverrideRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_type: string
  subject_id: number
  role_id: number
  override_type: string
  source_template_id: number | null
  reason: string | null
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'job'])
const ALLOWED_OVERRIDE_TYPES = new Set(['grant', 'exclude'])
const ALLOWED_STATUSES = new Set(['active', 'disabled'])

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

async function loadOverride(id: number) {
  return queryRow<TemplateOverrideRow>(
    `SELECT id, tenant_code, subject_type, subject_id, role_id, override_type, source_template_id,
            reason, status, created_at, updated_at
     FROM tenant_template_overrides
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const subjectType = requireAllowed(requireString(body.subjectType, 'subjectType'), 'subjectType', ALLOWED_SUBJECT_TYPES)
  const subjectId = Number(body.subjectId)
  const roleId = Number(body.roleId)
  const overrideType = requireAllowed(requireString(body.overrideType, 'overrideType'), 'overrideType', ALLOWED_OVERRIDE_TYPES)
  const sourceTemplateId = body.sourceTemplateId === undefined || body.sourceTemplateId === null
    ? null
    : Number(body.sourceTemplateId)
  const reason = normalizeNullableString(body.reason)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)

  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'subjectId is invalid'
    })
  }

  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'roleId is invalid'
    })
  }

  if (sourceTemplateId !== null && (!Number.isInteger(sourceTemplateId) || sourceTemplateId <= 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'sourceTemplateId is invalid'
    })
  }

  const subject = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_subjects
     WHERE id = ?
       AND tenant_code = ?
       AND subject_type = ?
     LIMIT 1`,
    [subjectId, tenantCode, subjectType]
  )

  if (!subject) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `subject not found: subjectId=${subjectId}, subjectType=${subjectType}`
    })
  }

  const role = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_roles
     WHERE id = ?
       AND tenant_code = ?
     LIMIT 1`,
    [roleId, tenantCode]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `role not found: roleId=${roleId}`
    })
  }

  if (sourceTemplateId !== null) {
    const template = await queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_permission_templates
       WHERE id = ?
         AND tenant_code = ?
       LIMIT 1`,
      [sourceTemplateId, tenantCode]
    )

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `source template not found: sourceTemplateId=${sourceTemplateId}`
      })
    }
  }

  const existing = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_template_overrides
     WHERE tenant_code = ?
       AND subject_type = ?
       AND subject_id = ?
       AND role_id = ?
       AND override_type = ?
       AND ((source_template_id IS NULL AND ? IS NULL) OR source_template_id = ?)
     LIMIT 1`,
    [tenantCode, subjectType, subjectId, roleId, overrideType, sourceTemplateId, sourceTemplateId]
  )

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `template override already exists: tenantCode=${tenantCode}, subjectId=${subjectId}, roleId=${roleId}, overrideType=${overrideType}`
    })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO tenant_template_overrides
      (tenant_code, subject_type, subject_id, role_id, override_type, source_template_id, reason, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tenantCode, subjectType, subjectId, roleId, overrideType, sourceTemplateId, reason, status]
  )

  const override = await loadOverride(result.insertId)
  if (!override) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created template override'
    })
  }

  return ok({
    id: override.id,
    tenantCode: override.tenant_code,
    subjectType: override.subject_type,
    subjectId: override.subject_id,
    roleId: override.role_id,
    overrideType: override.override_type,
    sourceTemplateId: override.source_template_id,
    reason: override.reason,
    status: override.status,
    createdAt: override.created_at,
    updatedAt: override.updated_at
  })
})
