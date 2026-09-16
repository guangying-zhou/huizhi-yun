import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'

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

const ALLOWED_TEMPLATE_TYPES = new Set(['job', 'duty', 'base', 'management'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
}

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
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)

  const existing = await loadTemplate(id)
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `template not found: id=${id}`
    })
  }

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.templateName !== undefined) {
    const templateName = String(body.templateName || '').trim()
    if (!templateName) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'templateName is required'
      })
    }
    updates.push('template_name = ?')
    params.push(templateName)
  }

  if (body.templateType !== undefined) {
    updates.push('template_type = ?')
    params.push(requireAllowed(String(body.templateType), 'templateType', ALLOWED_TEMPLATE_TYPES))
  }

  if (body.description !== undefined) {
    updates.push('description = ?')
    params.push(normalizeNullableString(body.description))
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isFinite(sortOrder)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'sortOrder is invalid'
      })
    }
    updates.push('sort_order = ?')
    params.push(sortOrder)
  }

  if (updates.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'no updatable fields provided'
    })
  }

  await execute<ResultSetHeader>(
    `UPDATE tenant_permission_templates
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    [...params, id]
  )

  const template = await loadTemplate(id)
  if (!template) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load updated template'
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
