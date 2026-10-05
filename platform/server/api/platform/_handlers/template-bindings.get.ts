import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface TemplateBindingRow extends RowDataPacket {
  id: number
  tenant_code: string
  template_id: number
  template_code: string
  template_name: string
  subject_type: string
  subject_id: number
  subject_code: string | null
  subject_display_name: string | null
  priority: number
  status: string
  start_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const subjectType = normalizeNullableString(query.subjectType)
  const subjectId = normalizeNullableString(query.subjectId)
  const templateId = normalizeNullableString(query.templateId)
  const status = normalizeNullableString(query.status)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tb.tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (subjectType) {
    where.push('tb.subject_type = ?')
    params.push(subjectType)
  }

  if (subjectId) {
    where.push('tb.subject_id = ?')
    params.push(Number(subjectId))
  }

  if (templateId) {
    where.push('tb.template_id = ?')
    params.push(Number(templateId))
  }

  if (status) {
    where.push('tb.status = ?')
    params.push(status)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const items = await queryRows<TemplateBindingRow[]>(
    `SELECT tb.id, tb.tenant_code, tb.template_id, tpt.template_code, tpt.template_name,
            tb.subject_type, tb.subject_id, ts.subject_code, ts.display_name AS subject_display_name,
            tb.priority, tb.status, tb.start_at, tb.end_at, tb.created_at, tb.updated_at
     FROM tenant_template_bindings tb
     INNER JOIN tenant_permission_templates tpt
       ON tpt.id = tb.template_id
      AND tpt.tenant_code = tb.tenant_code
     LEFT JOIN tenant_subjects ts
       ON ts.id = tb.subject_id
      AND ts.tenant_code = tb.tenant_code
     ${whereSql}
     ORDER BY tb.priority ASC, tb.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_template_bindings tb
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      templateId: item.template_id,
      templateCode: item.template_code,
      templateName: item.template_name,
      subjectType: item.subject_type,
      subjectId: item.subject_id,
      subjectCode: item.subject_code,
      subjectDisplayName: item.subject_display_name,
      priority: item.priority,
      status: item.status,
      startAt: item.start_at,
      endAt: item.end_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
