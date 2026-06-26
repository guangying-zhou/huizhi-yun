import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'

interface TemplateRow extends RowDataPacket {
  id: number
  tenant_code: string
}

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
}

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

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const roles = Array.isArray(body.roles) ? body.roles : null

  if (!roles) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'roles must be an array'
    })
  }

  const template = await queryRow<TemplateRow>(
    `SELECT id, tenant_code
     FROM tenant_permission_templates
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!template) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant template not found: id=${id}`
    })
  }

  const prepared = roles.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `roles[${index}] is invalid`
      })
    }

    const record = item as Record<string, unknown>
    const roleCode = String(record.roleCode || '').trim()
    const sortOrder = record.sortOrder === undefined ? 0 : Number(record.sortOrder)

    if (!roleCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `roles[${index}].roleCode is required`
      })
    }

    if (!Number.isFinite(sortOrder)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `roles[${index}].sortOrder is invalid`
      })
    }

    return { roleCode, sortOrder }
  })

  const uniqueKeys = new Set<string>()
  for (const role of prepared) {
    if (uniqueKeys.has(role.roleCode)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate template role entry: ${role.roleCode}`
      })
    }
    uniqueKeys.add(role.roleCode)
  }

  const applied = await withTransaction(async (tx) => {
    const resolved: Array<{ roleId: number, roleCode: string, sortOrder: number }> = []

    for (const role of prepared) {
      const targetRole = await tx.queryRow<RoleRow>(
        `SELECT id, tenant_code, role_code
         FROM tenant_roles
         WHERE role_code = ?
           AND tenant_code = ?
           AND status = 'active'
         LIMIT 1`,
        [role.roleCode, template.tenant_code]
      )

      if (!targetRole) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `role not found: roleCode=${role.roleCode}`
        })
      }

      resolved.push({
        roleId: targetRole.id,
        roleCode: targetRole.role_code,
        sortOrder: role.sortOrder
      })
    }

    await tx.execute<ResultSetHeader>(
      `DELETE FROM tenant_template_roles
       WHERE template_id = ?
         AND tenant_code = ?`,
      [id, template.tenant_code]
    )

    for (const role of resolved) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_template_roles
          (tenant_code, template_id, role_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [template.tenant_code, id, role.roleId, role.sortOrder]
      )
    }

    return resolved
  })

  return ok({
    templateId: id,
    tenantCode: template.tenant_code,
    roles: applied,
    total: applied.length
  })
})
