import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import { TENANT_CONSOLE_APP_CODE } from '~~/server/utils/tenantConsole'

interface TemplateRow extends RowDataPacket {
  id: number
  tenant_code: string
}

interface TemplateRoleRow extends RowDataPacket {
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  sort_order: number
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

  const template = await queryRow<TemplateRow>(
    `SELECT id, tenant_code
     FROM tenant_permission_templates
     WHERE id = ?
       AND template_type = 'management'
     LIMIT 1`,
    [id]
  )

  if (!template) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant console template not found: id=${id}`
    })
  }

  const items = await queryRows<TemplateRoleRow[]>(
    `SELECT ttr.role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code, ttr.sort_order
     FROM tenant_template_roles ttr
     INNER JOIN tenant_roles tr
       ON tr.id = ttr.role_id
      AND tr.tenant_code = ttr.tenant_code
     WHERE ttr.template_id = ?
       AND ttr.tenant_code = ?
       AND tr.app_code = ?
     ORDER BY ttr.sort_order ASC, tr.role_code ASC`,
    [id, template.tenant_code, TENANT_CONSOLE_APP_CODE]
  )

  return ok({
    templateId: id,
    tenantCode: template.tenant_code,
    items: items.map(item => ({
      roleId: item.role_id,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: item.role_type,
      appCode: item.app_code,
      sortOrder: item.sort_order
    })),
    total: items.length
  })
})
