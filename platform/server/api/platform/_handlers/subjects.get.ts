import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  user_id: number | null
  subject_type: string
  subject_code: string
  display_name: string | null
  external_ref: string | null
  parent_subject_id: number | null
  status: string
}

interface CountRow extends RowDataPacket {
  total: number
}

interface TableExistsRow extends RowDataPacket {
  tableName: string
}

interface SubjectMembershipRow extends RowDataPacket {
  subject_id: number
  container_subject_id: number
  relation_type: string
  is_primary: number
  status: string
}

function fromSql() {
  return 'FROM tenant_subjects ts'
}

async function membershipTableExists() {
  const row = await queryRow<TableExistsRow>(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tenant_subject_memberships'
      LIMIT 1`
  )

  return Boolean(row)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const subjectType = normalizeNullableString(query.subjectType)
  const status = normalizeNullableString(query.status)
  const keyword = normalizeNullableString(query.keyword)
  const all = normalizeNullableString(query.all) === 'true'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['ts.tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (subjectType) {
    where.push('ts.subject_type = ?')
    params.push(subjectType)
  }

  if (status) {
    where.push('ts.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(ts.subject_code LIKE ? OR COALESCE(ts.display_name, "") LIKE ? OR COALESCE(ts.external_ref, "") LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const from = fromSql()

  const selectSql = `SELECT ts.id, ts.tenant_code,
            CASE WHEN ts.subject_type = 'user' THEN ts.id ELSE NULL END AS user_id,
            ts.subject_type, ts.subject_code, ts.display_name, ts.external_ref, ts.parent_subject_id, ts.status
     ${from}
     ${whereSql}
     ORDER BY ts.subject_type ASC, ts.subject_code ASC`

  const items = await queryRows<SubjectRow[]>(
    all ? selectSql : `${selectSql} LIMIT ? OFFSET ?`,
    all ? params : [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     ${from}
     ${whereSql}`,
    params
  )
  const memberships = await (async () => {
    if (!await membershipTableExists()) return []

    return queryRows<SubjectMembershipRow[]>(
      `SELECT tsm.subject_id,
              tsm.container_subject_id,
              tsm.relation_type,
              tsm.is_primary,
              tsm.status
         FROM tenant_subject_memberships tsm
         INNER JOIN tenant_subjects subject
           ON subject.id = tsm.subject_id
          AND subject.tenant_code = tsm.tenant_code
         INNER JOIN tenant_subjects container
           ON container.id = tsm.container_subject_id
          AND container.tenant_code = tsm.tenant_code
        WHERE tsm.tenant_code = ?
          AND tsm.status = 'active'
          AND subject.status = 'active'
          AND container.status = 'active'
        ORDER BY container.subject_type ASC, container.subject_code ASC, subject.subject_type ASC, subject.subject_code ASC`,
      [tenantCode]
    )
  })()

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      userId: item.user_id,
      subjectType: item.subject_type,
      subjectCode: item.subject_code,
      displayName: item.display_name || item.subject_code,
      externalRef: item.external_ref,
      parentSubjectId: item.parent_subject_id,
      status: item.status
    })),
    memberships: memberships.map(item => ({
      subjectId: item.subject_id,
      containerSubjectId: item.container_subject_id,
      relationType: item.relation_type,
      isPrimary: Boolean(item.is_primary),
      status: item.status
    })),
    total: totalRow?.total || 0,
    page: all ? 1 : page,
    pageSize: all ? items.length : pageSize
  })
})
