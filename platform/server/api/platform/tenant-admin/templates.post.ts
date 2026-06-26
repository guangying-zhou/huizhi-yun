import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface TemplateRow extends RowDataPacket {
  id: number
  tenant_code: string
  template_code: string
  template_name: string
  template_type: string
  description: string | null
  status: string
  sort_order: number
  created_at: string
  updated_at: string
}

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

async function loadTemplate(id: number) {
  return queryRow<TemplateRow>(
    `SELECT id, tenant_code, template_code, template_name, template_type, description,
            status, sort_order, created_at, updated_at
     FROM tenant_permission_templates
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const templateCode = requireString(body.templateCode, 'templateCode')
  const templateName = requireString(body.templateName, 'templateName')
  const templateType = 'management'
  const description = normalizeNullableString(body.description)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const sortOrder = body.sortOrder === undefined ? 0 : Number(body.sortOrder)

  if (!Number.isFinite(sortOrder)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'sortOrder is invalid'
    })
  }

  const templateId = await withTransaction(async (tx) => {
    const tenant = await tx.queryRow<RowDataPacket>(
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

    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM tenant_permission_templates
       WHERE tenant_code = ?
         AND template_code = ?
       LIMIT 1`,
      [tenantCode, templateCode]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `template already exists: tenantCode=${tenantCode}, templateCode=${templateCode}`
      })
    }

    const result = await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_permission_templates
        (tenant_code, template_code, template_name, template_type, description,
         source, is_overridden, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'custom', 0, ?, ?, NOW(), NOW())`,
      [tenantCode, templateCode, templateName, templateType, description, sortOrder, status]
    )

    return result.insertId
  })

  const template = await loadTemplate(templateId)
  if (!template) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created template'
    })
  }

  return ok({
    id: template.id,
    tenantCode: template.tenant_code,
    templateCode: template.template_code,
    templateName: template.template_name,
    templateType: template.template_type,
    description: template.description,
    status: template.status,
    sortOrder: template.sort_order,
    createdAt: template.created_at,
    updatedAt: template.updated_at
  })
})
