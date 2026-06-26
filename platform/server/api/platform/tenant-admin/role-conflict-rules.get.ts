import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface RuleRow extends RowDataPacket {
  id: number
  tenant_code: string
  rule_code: string
  rule_name: string
  conflict_type: string
  enforcement: string
  left_role_code: string | null
  right_role_code: string | null
  left_app_code: string | null
  left_resource_code: string | null
  left_action: string | null
  right_app_code: string | null
  right_resource_code: string | null
  right_action: string | null
  description: string | null
  status: string
  created_by_uid: string | null
  created_at: string
  updated_at: string
}

function isMissingTableError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  return err?.code === 'ER_NO_SUCH_TABLE'
    || err?.errno === 1146
    || String(err?.message || '').includes('tenant_role_conflict_rules')
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const status = normalizeNullableString(query.status)

  const where = ['tenant_code = ?']
  const params: string[] = [tenantCode]

  if (status) {
    where.push('status = ?')
    params.push(status)
  }

  try {
    const rows = await queryRows<RuleRow[]>(
      `SELECT id, tenant_code, rule_code, rule_name, conflict_type, enforcement,
              left_role_code, right_role_code,
              left_app_code, left_resource_code, left_action,
              right_app_code, right_resource_code, right_action,
              description, status, created_by_uid, created_at, updated_at
       FROM tenant_role_conflict_rules
       WHERE ${where.join(' AND ')}
       ORDER BY status ASC, rule_code ASC`,
      params
    )

    return ok({
      items: rows.map(row => ({
        id: row.id,
        tenantCode: row.tenant_code,
        ruleCode: row.rule_code,
        ruleName: row.rule_name,
        conflictType: row.conflict_type,
        enforcement: row.enforcement,
        leftRoleCode: row.left_role_code,
        rightRoleCode: row.right_role_code,
        leftAppCode: row.left_app_code,
        leftResourceCode: row.left_resource_code,
        leftAction: row.left_action,
        rightAppCode: row.right_app_code,
        rightResourceCode: row.right_resource_code,
        rightAction: row.right_action,
        description: row.description,
        status: row.status,
        createdByUid: row.created_by_uid,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total: rows.length,
      migrationRequired: false
    })
  } catch (error) {
    if (!isMissingTableError(error)) throw error

    return ok({
      items: [],
      total: 0,
      migrationRequired: true
    })
  }
})
