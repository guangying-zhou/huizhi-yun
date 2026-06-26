import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface TemplateBindingRow extends RowDataPacket {
  id: number
  tenant_code: string
  template_id: number
  subject_type: string
  subject_id: number
  priority: number
  status: string
  start_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
}

const ALLOWED_SUBJECT_TYPES = new Set(['user', 'department', 'job'])
const ALLOWED_STATUSES = new Set(['active', 'paused', 'disabled'])

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

async function loadBinding(id: number) {
  return queryRow<TemplateBindingRow>(
    `SELECT id, tenant_code, template_id, subject_type, subject_id, priority, status,
            start_at, end_at, created_at, updated_at
     FROM tenant_template_bindings
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const templateId = Number(body.templateId)
  const subjectType = requireAllowed(requireString(body.subjectType, 'subjectType'), 'subjectType', ALLOWED_SUBJECT_TYPES)
  const subjectId = Number(body.subjectId)
  const priority = body.priority === undefined ? 100 : Number(body.priority)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const startAt = normalizeNullableString(body.startAt)
  const endAt = normalizeNullableString(body.endAt)

  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'templateId is invalid'
    })
  }

  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'subjectId is invalid'
    })
  }

  if (!Number.isFinite(priority)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'priority is invalid'
    })
  }

  const template = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_permission_templates
     WHERE id = ?
       AND tenant_code = ?
     LIMIT 1`,
    [templateId, tenantCode]
  )

  if (!template) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `template not found: templateId=${templateId}`
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

  const existing = await queryRow<RowDataPacket>(
    `SELECT id
     FROM tenant_template_bindings
     WHERE tenant_code = ?
       AND template_id = ?
       AND subject_type = ?
       AND subject_id = ?
     LIMIT 1`,
    [tenantCode, templateId, subjectType, subjectId]
  )

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `template binding already exists: tenantCode=${tenantCode}, templateId=${templateId}, subjectType=${subjectType}, subjectId=${subjectId}`
    })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO tenant_template_bindings
      (tenant_code, template_id, subject_type, subject_id, priority, status, start_at, end_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tenantCode, templateId, subjectType, subjectId, priority, status, startAt, endAt]
  )

  const binding = await loadBinding(result.insertId)
  if (!binding) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created template binding'
    })
  }

  return ok({
    id: binding.id,
    tenantCode: binding.tenant_code,
    templateId: binding.template_id,
    subjectType: binding.subject_type,
    subjectId: binding.subject_id,
    priority: binding.priority,
    status: binding.status,
    startAt: binding.start_at,
    endAt: binding.end_at,
    createdAt: binding.created_at,
    updatedAt: binding.updated_at
  })
})
