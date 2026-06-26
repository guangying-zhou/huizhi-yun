import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

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

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const templateType = normalizeNullableString(query.templateType)
  const status = normalizeNullableString(query.status)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (templateType) {
    where.push('template_type = ?')
    params.push(templateType)
  }

  if (status) {
    where.push('status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(template_code LIKE ? OR template_name LIKE ? OR COALESCE(description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<TemplateRow[]>(
    `SELECT id, tenant_code, template_code, template_name, template_type, description,
            status, sort_order, created_at, updated_at
     FROM tenant_permission_templates
     ${whereSql}
     ORDER BY sort_order ASC, template_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_permission_templates
     ${whereSql}`,
    params
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
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
