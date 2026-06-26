import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface AuditRow extends RowDataPacket {
  id: number
  tenant_code: string
  operator_uid: string | null
  action: string
  target_type: string | null
  target_id: string | null
  source: string | null
  ip: string | null
  created_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

function requireTenantCode(event: H3Event) {
  return requireString(getRouterParam(event, 'tenantCode'), 'tenantCode').trim()
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { code?: string, message?: string }
  return record.code === 'ER_NO_SUCH_TABLE' || String(record.message || '').includes('doesn\'t exist')
}

function toneByAction(action: string) {
  const normalized = String(action || '').toLowerCase()
  if (/(delete|revoke|suspend|terminate|fail|deny)/.test(normalized)) {
    return 'error'
  }

  if (/(update|patch|grant|assign|rotate|publish)/.test(normalized)) {
    return 'warning'
  }

  if (/(create|issue|activate|import|deploy)/.test(normalized)) {
    return 'success'
  }

  return 'info'
}

export default defineEventHandler(async (event) => {
  const tenantCode = requireTenantCode(event)
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (keyword) {
    where.push('(COALESCE(operator_uid, \'\') LIKE ? OR action LIKE ? OR COALESCE(target_type, \'\') LIKE ? OR COALESCE(target_id, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  try {
    const items = await queryRows<AuditRow[]>(
      `SELECT id, tenant_code, operator_uid, action, target_type, target_id, source, ip, created_at
       FROM tenant_audit_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    const totalRow = await queryRow<CountRow>(
      `SELECT COUNT(*) AS total
       FROM tenant_audit_logs
       ${whereSql}`,
      params
    )

    return ok({
      items: items.map(item => ({
        id: item.id,
        tenantCode: item.tenant_code,
        operatorUid: item.operator_uid,
        action: item.action,
        targetType: item.target_type,
        targetId: item.target_id,
        source: item.source,
        ip: item.ip,
        createdAt: item.created_at,
        tone: toneByAction(item.action)
      })),
      total: totalRow?.total || 0,
      page,
      pageSize
    })
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  const fallbackWhere: string[] = ['tenant_code = ?']
  const fallbackParams: Array<string | number> = [tenantCode]
  if (keyword) {
    fallbackWhere.push('(event_type LIKE ? OR COALESCE(CAST(event_data_json AS CHAR), \'\') LIKE ?)')
    fallbackParams.push(`%${keyword}%`, `%${keyword}%`)
  }
  const fallbackWhereSql = `WHERE ${fallbackWhere.join(' AND ')}`

  try {
    const items = await queryRows<RowDataPacket[]>(
      `SELECT id, tenant_code, event_type, event_data_json, created_at
       FROM platform_tenant_lifecycle_events
       ${fallbackWhereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...fallbackParams, pageSize, offset]
    )

    const totalRow = await queryRow<CountRow>(
      `SELECT COUNT(*) AS total
       FROM platform_tenant_lifecycle_events
       ${fallbackWhereSql}`,
      fallbackParams
    )

    return ok({
      items: items.map(item => ({
        id: Number(item.id),
        tenantCode: String(item.tenant_code),
        operatorUid: null,
        action: String(item.event_type || 'lifecycle_event'),
        targetType: 'tenant',
        targetId: String(item.tenant_code || tenantCode),
        source: 'platform_lifecycle',
        ip: null,
        createdAt: String(item.created_at),
        tone: toneByAction(String(item.event_type || 'lifecycle_event'))
      })),
      total: totalRow?.total || 0,
      page,
      pageSize
    })
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  return ok({
    items: [],
    total: 0,
    page,
    pageSize
  })
})
