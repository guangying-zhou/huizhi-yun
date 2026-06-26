import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { buildDbAuthorizationGrants } from '~~/server/utils/authorization'
import { queryRow, queryRows } from '~~/server/utils/db'

interface MemberRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_code: string
  display_name: string | null
  external_ref: string | null
  status: string
  active_role_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

interface MembershipRow extends RowDataPacket {
  container_subject_type: string
  container_subject_code: string
  container_display_name: string | null
  relation_type: string
  is_primary: number
}

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  source: string
}

function queryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim() || null
}

function permissionKey(permission: { appCode: string, resourceCode: string, action: string }) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function scopeText(scope: { dimension: string, predicate: string, value?: string | null, source: string }) {
  const value = scope.value ? `:${scope.value}` : ''
  return `${scope.dimension}:${scope.predicate}${value}(${scope.source})`
}

function categorizeRole(roleCode: string, roleName: string) {
  const text = `${roleCode} ${roleName}`.toLowerCase()
  if (/(admin|owner|security|deploy|release|root|高权限|安全|发布|管理员)/.test(text)) return 'high_risk_privilege'
  if (/(approve|approval|confirm|audit|review|审批|确认|复核|审计)/.test(text)) return 'approval_duty'
  if (/(manager|leader|lead|head|director|负责人|主管|经理|总监)/.test(text)) return 'management_duty'
  return 'main_position'
}

async function loadMemberByUid(tenantCode: string, uid: string) {
  return queryRow<MemberRow>(
    `SELECT id, tenant_code, subject_code, display_name, external_ref, status, 0 AS active_role_count
     FROM tenant_subjects
     WHERE tenant_code = ?
       AND subject_type = 'user'
       AND (subject_code = ? OR external_ref = ?)
       AND status = 'active'
     LIMIT 1`,
    [tenantCode, uid, uid]
  )
}

async function listMembers(query: Record<string, unknown>) {
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const keyword = normalizeNullableString(query.keyword)
  const { page, pageSize, offset } = parsePagination(query)
  const where = ['ts.tenant_code = ?', 'ts.subject_type = \'user\'', 'ts.status = \'active\'']
  const params: Array<string | number> = [tenantCode]

  if (keyword) {
    where.push('(ts.subject_code LIKE ? OR ts.display_name LIKE ? OR COALESCE(ts.external_ref, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = await queryRows<MemberRow[]>(
    `SELECT ts.id, ts.tenant_code, ts.subject_code, ts.display_name, ts.external_ref, ts.status,
            COUNT(DISTINCT CASE
              WHEN tsr.status = 'active'
               AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
               AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
              THEN tsr.role_id ELSE NULL
            END) AS active_role_count
     FROM tenant_subjects ts
     LEFT JOIN tenant_subject_roles tsr
       ON tsr.tenant_code = ts.tenant_code
      AND tsr.subject_id = ts.id
     ${whereSql}
     GROUP BY ts.id, ts.tenant_code, ts.subject_code, ts.display_name, ts.external_ref, ts.status
     ORDER BY ts.display_name ASC, ts.subject_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_subjects ts
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      tenantCode: row.tenant_code,
      uid: row.external_ref || row.subject_code,
      subjectCode: row.subject_code,
      displayName: row.display_name || row.subject_code,
      status: row.status,
      activeRoleCount: Number(row.active_role_count || 0)
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
}

async function loadMemberDetail(query: Record<string, unknown>) {
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const uid = requireString(query.uid, 'uid')
  const activeRoleCode = queryValue(query.activeRoleCode)
  const authorizationMode = queryValue(query.authorizationMode)
  const member = await loadMemberByUid(tenantCode, uid)

  if (!member) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `member not found: ${uid}`
    })
  }

  const [memberships, grantResult] = await Promise.all([
    queryRows<MembershipRow[]>(
      `SELECT container.subject_type AS container_subject_type,
              container.subject_code AS container_subject_code,
              container.display_name AS container_display_name,
              tsm.relation_type,
              tsm.is_primary
       FROM tenant_subject_memberships tsm
       INNER JOIN tenant_subjects container
         ON container.id = tsm.container_subject_id
        AND container.tenant_code = tsm.tenant_code
        AND container.status = 'active'
       WHERE tsm.tenant_code = ?
         AND tsm.subject_id = ?
         AND tsm.status = 'active'
       ORDER BY tsm.is_primary DESC, container.subject_type ASC, container.subject_code ASC`,
      [tenantCode, member.id]
    ),
    buildDbAuthorizationGrants(tenantCode, uid, null, {
      activeRoleCode,
      authorizationMode,
      allowRoleSimulation: authorizationMode === 'role_simulation',
      allowUserSimulation: authorizationMode === 'user_simulation'
    })
  ])

  const roleRows = grantResult.roleIds.length
    ? await queryRows<RoleRow[]>(
        `SELECT id, role_code, role_name, role_type, source
       FROM tenant_roles
       WHERE tenant_code = ?
         AND id IN (${grantResult.roleIds.map(() => '?').join(', ')})`,
        [tenantCode, ...grantResult.roleIds]
      )
    : []
  const roleByCode = new Map(roleRows.map(role => [role.role_code, role]))
  const roleMap = new Map<string, {
    roleCode: string
    roleName: string
    roleType: string
    source: string
    category: string
    sourceTypes: Set<string>
    subjectTypes: Set<string>
    permissionCount: number
  }>()
  const permissionMap = new Map<string, {
    appCode: string
    resourceCode: string
    action: string
    sources: Array<{ roleCode: string | null, sourceType: string, scopes: string[] }>
  }>()

  for (const grant of grantResult.grants) {
    const roleCode = grant.roleCode || ''
    const roleRow = roleByCode.get(roleCode)
    const role = roleMap.get(roleCode) || {
      roleCode,
      roleName: roleRow?.role_name || roleCode,
      roleType: roleRow?.role_type || 'custom',
      source: roleRow?.source || grant.sourceType,
      category: categorizeRole(roleCode, roleRow?.role_name || roleCode),
      sourceTypes: new Set<string>(),
      subjectTypes: new Set<string>(),
      permissionCount: 0
    }
    role.sourceTypes.add(grant.sourceType)
    role.subjectTypes.add(grant.subjectType)
    role.permissionCount += 1
    roleMap.set(roleCode, role)

    const key = permissionKey(grant.permission)
    const permission = permissionMap.get(key) || {
      ...grant.permission,
      sources: []
    }
    permission.sources.push({
      roleCode: grant.roleCode || null,
      sourceType: grant.sourceType,
      scopes: [
        ...(grant.defaultScopes || []),
        ...(grant.assignmentScopes || []),
        ...(grant.scopes || [])
      ].map(scopeText)
    })
    permissionMap.set(key, permission)
  }

  return ok({
    member: {
      id: member.id,
      tenantCode: member.tenant_code,
      uid: member.external_ref || member.subject_code,
      subjectCode: member.subject_code,
      displayName: member.display_name || member.subject_code,
      status: member.status
    },
    simulation: {
      authorizationMode: authorizationMode || 'merged',
      activeRoleCode,
      selectedRoleCodes: grantResult.selectedRoleCodes,
      availableRoleCodes: grantResult.availableRoleCodes
    },
    memberships: memberships.map(item => ({
      subjectType: item.container_subject_type,
      subjectCode: item.container_subject_code,
      displayName: item.container_display_name || item.container_subject_code,
      relationType: item.relation_type,
      primary: Boolean(item.is_primary)
    })),
    roles: Array.from(roleMap.values()).map(role => ({
      ...role,
      sourceTypes: Array.from(role.sourceTypes),
      subjectTypes: Array.from(role.subjectTypes)
    })).sort((left, right) => left.category.localeCompare(right.category) || left.roleCode.localeCompare(right.roleCode)),
    permissions: Array.from(permissionMap.values()).sort((left, right) =>
      left.appCode.localeCompare(right.appCode)
      || left.resourceCode.localeCompare(right.resourceCode)
      || left.action.localeCompare(right.action)
    )
  })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, unknown>
  return queryValue(query.uid) ? loadMemberDetail(query) : listMembers(query)
})
