import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface TemplateRow extends RowDataPacket {
  id: number
  tenant_code: string
  template_code: string
  template_name: string
  template_type: string
  description: string | null
  status: string
  sort_order: number
  role_count: number
}

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const tenantCode = normalizeNullableString(getQuery(event).tenantCode)

  if (!tenantCode) {
    return ok({
      items: []
    })
  }

  const items = await queryRows<TemplateRow[]>(
    `SELECT tpt.id, tpt.tenant_code, tpt.template_code, tpt.template_name, tpt.template_type,
            tpt.description, tpt.status, tpt.sort_order,
            COUNT(DISTINCT tr.id) AS role_count
     FROM tenant_permission_templates tpt
     INNER JOIN tenant_template_roles ttr
       ON ttr.template_id = tpt.id
      AND ttr.tenant_code = tpt.tenant_code
     INNER JOIN tenant_roles tr
       ON tr.id = ttr.role_id
      AND tr.tenant_code = ttr.tenant_code
     WHERE tpt.tenant_code = ?
       AND tr.app_code = ?
     GROUP BY tpt.id, tpt.tenant_code, tpt.template_code, tpt.template_name, tpt.template_type,
              tpt.description, tpt.status, tpt.sort_order
     ORDER BY tpt.sort_order ASC, tpt.template_code ASC`,
    [tenantCode, appCode]
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      templateCode: item.template_code,
      templateName: item.template_name,
      templateType: item.template_type,
      description: item.description,
      status: item.status,
      sortOrder: item.sort_order,
      roleCount: Number(item.role_count || 0)
    }))
  })
})
