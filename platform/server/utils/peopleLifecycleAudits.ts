import type { RowDataPacket } from 'mysql2/promise'

export interface PeopleLifecycleAuditExecutor {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

export interface ListPeopleLifecycleAuditInput {
  tenantCode: string
  page: number
  pageSize: number
  offset: number
  uid?: string | null
  action?: string | null
  source?: string | null
  keyword?: string | null
}

interface AuditRow extends RowDataPacket {
  id: number
  tenant_code: string
  operator_uid: string | null
  action: string
  target_type: string
  target_id: string
  source: string | null
  before_json: string | null
  after_json: string | null
  created_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

const lifecycleActions = new Set([
  'authorization.user.position.sync.from_people',
  'authorization.user.offboard.from_people'
])

function text(value: unknown) {
  return String(value || '').trim()
}

function actionFilter(value: unknown) {
  const normalized = text(value)
  if (!normalized || normalized === 'all') return ''
  if (normalized === 'position_sync') return 'authorization.user.position.sync.from_people'
  if (normalized === 'offboarding') return 'authorization.user.offboard.from_people'
  return lifecycleActions.has(normalized) ? normalized : ''
}

function parseJsonObject(value: unknown) {
  if (!value) return null
  if (typeof value === 'object') return value as Record<string, unknown>

  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function summarizeStatus(action: string, after: Record<string, unknown> | null) {
  if (action === 'authorization.user.position.sync.from_people') {
    return after?.roleMatched === true ? 'synced' : 'no_matching_position_role'
  }
  if (action === 'authorization.user.offboard.from_people') {
    return after?.subjectFound === false ? 'subject_missing' : 'revoked'
  }
  return 'recorded'
}

export async function listPeopleLifecycleAudits(
  executor: PeopleLifecycleAuditExecutor,
  input: ListPeopleLifecycleAuditInput
) {
  const tenantCode = text(input.tenantCode)
  if (!tenantCode) {
    throw new Error('tenantCode is required')
  }

  const where = [
    'tenant_code = ?',
    'target_type = \'user\'',
    `action IN (${Array.from(lifecycleActions).map(() => '?').join(', ')})`
  ]
  const params: Array<string | number> = [tenantCode, ...Array.from(lifecycleActions)]
  const uid = text(input.uid)
  const source = text(input.source)
  const keyword = text(input.keyword)
  const action = actionFilter(input.action)

  if (uid) {
    where.push('target_id = ?')
    params.push(uid)
  }
  if (source) {
    where.push('source = ?')
    params.push(source)
  }
  if (action) {
    where.push('action = ?')
    params.push(action)
  }
  if (keyword) {
    where.push('(COALESCE(operator_uid, \'\') LIKE ? OR target_id LIKE ? OR action LIKE ? OR COALESCE(source, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || 20), 100))
  const page = Math.max(1, Number(input.page || 1))
  const offset = Math.max(0, Number(input.offset || 0))

  const rows = await executor.queryRows<AuditRow[]>(
    `SELECT id, tenant_code, operator_uid, action, target_type, target_id, source,
            JSON_EXTRACT(before_json, '$') AS before_json,
            JSON_EXTRACT(after_json, '$') AS after_json,
            created_at
       FROM tenant_audit_logs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const count = await executor.queryRow<CountRow>(
    `SELECT COUNT(*) AS total
       FROM tenant_audit_logs
       ${whereSql}`,
    params
  )

  return {
    items: rows.map((row) => {
      const before = parseJsonObject(row.before_json)
      const after = parseJsonObject(row.after_json)
      return {
        id: row.id,
        tenantCode: row.tenant_code,
        uid: row.target_id,
        operatorUid: row.operator_uid,
        action: row.action,
        source: row.source,
        status: summarizeStatus(row.action, after),
        before,
        after,
        createdAt: row.created_at
      }
    }),
    total: Number(count?.total || 0),
    page,
    pageSize
  }
}
