import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { buildDbAuthorizationGrants } from '~~/server/utils/authorization'
import { queryRow, queryRows } from '~~/server/utils/db'
import {
  deriveRoleCatalogCategory,
  isRoleCatalogMetadataMissingTableError
} from '~~/server/utils/roleCatalogCategory'

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
  description: string | null
  source: string
  catalog_category: string | null
}

interface DirectAssignmentRow extends RowDataPacket {
  id: number
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  role_description: string | null
  app_code: string | null
  role_source: string
  catalog_category: string | null
  source_type: string
  source_id: string | null
  assignment_kind: string
  reason: string | null
  granted_by_uid: string | null
  granted_at: string
  starts_at: string | null
  expired_at: string | null
  status: string
  active: number
}

interface EffectiveMembershipForCountRow extends RowDataPacket {
  user_subject_id: number
  subject_id: number
  subject_type: string
}

interface RoleSourceForCountRow extends RowDataPacket {
  subject_id: number
  role_id: number
  source_type?: string | null
}

interface RoleOverrideForCountRow extends RowDataPacket {
  subject_id: number
  role_id: number
  override_type: 'grant' | 'exclude'
}

interface EffectiveSubjectBindingForCount {
  userSubjectId: number
  inherited: boolean
  subjectType: string
}

const ACTIVE_ENTERPRISE_ROLE_SQL = `
       AND tr.app_code IS NULL
       AND tr.status = 'active'
       AND tr.is_assignable = 1`

function queryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim() || null
}

function queryBooleanValue(value: unknown, fallback = true) {
  const normalized = String(Array.isArray(value) ? value[0] : value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return !['0', 'false', 'no', 'off'].includes(normalized)
}

function permissionKey(permission: { appCode: string, resourceCode: string, action: string }) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function scopeText(scope: { dimension: string, predicate: string, value?: string | null, source: string }) {
  const value = scope.value ? `:${scope.value}` : ''
  return `${scope.dimension}:${scope.predicate}${value}(${scope.source})`
}

function categorizeRole(input: {
  roleCode: string
  roleName: string
  description?: string | null
  source?: string | null
  catalogCategory?: string | null
}) {
  return deriveRoleCatalogCategory({
    roleCode: input.roleCode,
    roleName: input.roleName,
    description: input.description,
    source: input.source,
    catalogCategory: input.catalogCategory
  }).category
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => '?').join(', ')
}

function addSubjectBinding(
  bindingsBySubjectId: Map<number, EffectiveSubjectBindingForCount[]>,
  subjectId: number,
  binding: EffectiveSubjectBindingForCount
) {
  const bindings = bindingsBySubjectId.get(subjectId) || []
  bindings.push(binding)
  bindingsBySubjectId.set(subjectId, bindings)
}

function addRoleSourceForUser(
  sourcesByUserId: Map<number, Map<number, string[]>>,
  userSubjectId: number,
  roleId: number,
  sourceType: string
) {
  const sourcesByRoleId = sourcesByUserId.get(userSubjectId)
  if (!sourcesByRoleId) return

  const sources = sourcesByRoleId.get(roleId) || []
  sources.push(sourceType)
  sourcesByRoleId.set(roleId, sources)
}

function removeDirectTemplateRoleSourcesForUser(
  sourcesByUserId: Map<number, Map<number, string[]>>,
  userSubjectId: number,
  roleId: number
) {
  const sourcesByRoleId = sourcesByUserId.get(userSubjectId)
  if (!sourcesByRoleId) return

  const remaining = (sourcesByRoleId.get(roleId) || []).filter(sourceType => sourceType !== 'template')
  if (remaining.length) {
    sourcesByRoleId.set(roleId, remaining)
    return
  }

  sourcesByRoleId.delete(roleId)
}

async function loadActiveRoleCounts(tenantCode: string, members: MemberRow[]) {
  const userSubjectIds = members.map(member => member.id)
  const sourcesByUserId = new Map<number, Map<number, string[]>>(
    userSubjectIds.map(subjectId => [subjectId, new Map<number, string[]>()])
  )
  const bindingsBySubjectId = new Map<number, EffectiveSubjectBindingForCount[]>()

  if (!userSubjectIds.length) return new Map<number, number>()

  for (const userSubjectId of userSubjectIds) {
    addSubjectBinding(bindingsBySubjectId, userSubjectId, {
      userSubjectId,
      inherited: false,
      subjectType: 'user'
    })
  }

  const userPlaceholders = placeholders(userSubjectIds)
  const memberships = await queryRows<EffectiveMembershipForCountRow[]>(
    `SELECT tsm.subject_id AS user_subject_id,
            container.id AS subject_id,
            container.subject_type
     FROM tenant_subject_memberships tsm
     INNER JOIN tenant_subjects container
       ON container.id = tsm.container_subject_id
      AND container.tenant_code = tsm.tenant_code
      AND container.status = 'active'
     WHERE tsm.tenant_code = ?
       AND tsm.subject_id IN (${userPlaceholders})
       AND tsm.status = 'active'
       AND tsm.relation_type IN ('member', 'manager', 'leader')
       AND container.subject_type IN ('department', 'job')`,
    [tenantCode, ...userSubjectIds]
  )

  for (const membership of memberships) {
    addSubjectBinding(bindingsBySubjectId, membership.subject_id, {
      userSubjectId: membership.user_subject_id,
      inherited: true,
      subjectType: membership.subject_type
    })
  }

  const effectiveSubjectIds = Array.from(bindingsBySubjectId.keys())
  const effectivePlaceholders = placeholders(effectiveSubjectIds)
  const [directRoles, templateRoles, overrides] = await Promise.all([
    queryRows<RoleSourceForCountRow[]>(
      `SELECT tsr.subject_id,
              tr.id AS role_id,
              tsr.source_type
       FROM tenant_subject_roles tsr
       INNER JOIN tenant_roles tr
         ON tr.id = tsr.role_id
        AND tr.tenant_code = tsr.tenant_code
       WHERE tsr.tenant_code = ?
         AND tsr.subject_id IN (${effectivePlaceholders})
         AND tsr.status = 'active'
         AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
         AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
         ${ACTIVE_ENTERPRISE_ROLE_SQL}`,
      [tenantCode, ...effectiveSubjectIds]
    ),
    queryRows<RoleSourceForCountRow[]>(
      `SELECT ttb.subject_id,
              tr.id AS role_id
       FROM tenant_template_bindings ttb
       INNER JOIN tenant_permission_templates tpt
         ON tpt.id = ttb.template_id
        AND tpt.tenant_code = ttb.tenant_code
       INNER JOIN tenant_template_roles ttr
         ON ttr.template_id = tpt.id
        AND ttr.tenant_code = tpt.tenant_code
       INNER JOIN tenant_roles tr
         ON tr.id = ttr.role_id
        AND tr.tenant_code = tpt.tenant_code
       WHERE ttb.tenant_code = ?
         AND ttb.subject_id IN (${effectivePlaceholders})
         AND ttb.status = 'active'
         AND (ttb.start_at IS NULL OR ttb.start_at <= UTC_TIMESTAMP())
         AND (ttb.end_at IS NULL OR ttb.end_at > UTC_TIMESTAMP())
         AND tpt.status = 'active'
         ${ACTIVE_ENTERPRISE_ROLE_SQL}`,
      [tenantCode, ...effectiveSubjectIds]
    ),
    queryRows<RoleOverrideForCountRow[]>(
      `SELECT tto.subject_id,
              tr.id AS role_id,
              tto.override_type
       FROM tenant_template_overrides tto
       INNER JOIN tenant_roles tr
         ON tr.id = tto.role_id
        AND tr.tenant_code = tto.tenant_code
       WHERE tto.tenant_code = ?
         AND tto.subject_id IN (${effectivePlaceholders})
         AND tto.status = 'active'
         AND tto.override_type IN ('grant', 'exclude')
         ${ACTIVE_ENTERPRISE_ROLE_SQL}`,
      [tenantCode, ...effectiveSubjectIds]
    )
  ])

  for (const row of directRoles) {
    for (const binding of bindingsBySubjectId.get(row.subject_id) || []) {
      addRoleSourceForUser(
        sourcesByUserId,
        binding.userSubjectId,
        row.role_id,
        binding.inherited ? `membership:${binding.subjectType}` : row.source_type || 'manual'
      )
    }
  }

  for (const row of templateRoles) {
    for (const binding of bindingsBySubjectId.get(row.subject_id) || []) {
      addRoleSourceForUser(
        sourcesByUserId,
        binding.userSubjectId,
        row.role_id,
        binding.inherited ? `membership:${binding.subjectType}:template` : 'template'
      )
    }
  }

  for (const row of overrides) {
    for (const binding of bindingsBySubjectId.get(row.subject_id) || []) {
      if (row.override_type === 'exclude') {
        removeDirectTemplateRoleSourcesForUser(sourcesByUserId, binding.userSubjectId, row.role_id)
      } else {
        addRoleSourceForUser(
          sourcesByUserId,
          binding.userSubjectId,
          row.role_id,
          binding.inherited ? `membership:${binding.subjectType}:override_grant` : 'override_grant'
        )
      }
    }
  }

  return new Map(userSubjectIds.map(userSubjectId => [
    userSubjectId,
    sourcesByUserId.get(userSubjectId)?.size || 0
  ]))
}

async function loadRoleRows(tenantCode: string, roleIds: number[], includeMetadata = true): Promise<RoleRow[]> {
  if (!roleIds.length) return []

  const metadataColumn = includeMetadata ? 'trcm.category AS catalog_category' : 'NULL AS catalog_category'
  const metadataJoin = includeMetadata
    ? `LEFT JOIN tenant_role_catalog_metadata trcm
         ON trcm.tenant_code = tr.tenant_code
        AND trcm.role_id = tr.id`
    : ''

  try {
    return await queryRows<RoleRow[]>(
      `SELECT tr.id,
              tr.role_code,
              tr.role_name,
              tr.role_type,
              tr.description,
              tr.source,
              ${metadataColumn}
       FROM tenant_roles tr
       ${metadataJoin}
       WHERE tr.tenant_code = ?
         AND tr.id IN (${roleIds.map(() => '?').join(', ')})`,
      [tenantCode, ...roleIds]
    )
  } catch (error) {
    if (!includeMetadata || !isRoleCatalogMetadataMissingTableError(error)) throw error
    return loadRoleRows(tenantCode, roleIds, false)
  }
}

async function loadDirectAssignments(tenantCode: string, subjectId: number, includeMetadata = true): Promise<DirectAssignmentRow[]> {
  const metadataColumn = includeMetadata ? 'trcm.category AS catalog_category' : 'NULL AS catalog_category'
  const metadataJoin = includeMetadata
    ? `LEFT JOIN tenant_role_catalog_metadata trcm
         ON trcm.tenant_code = tr.tenant_code
        AND trcm.role_id = tr.id`
    : ''

  try {
    return await queryRows<DirectAssignmentRow[]>(
      `SELECT tsr.id,
              tsr.role_id,
              tr.role_code,
              tr.role_name,
              tr.role_type,
              tr.description AS role_description,
              tr.app_code,
              tr.source AS role_source,
              ${metadataColumn},
              tsr.source_type,
              tsr.source_id,
              tsr.assignment_kind,
              tsr.reason,
              tsr.granted_by_uid,
              tsr.granted_at,
              tsr.starts_at,
              tsr.expired_at,
              tsr.status,
              CASE
                WHEN tsr.status = 'active'
                 AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
                 AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
                THEN 1 ELSE 0
              END AS active
       FROM tenant_subject_roles tsr
       INNER JOIN tenant_roles tr
         ON tr.id = tsr.role_id
        AND tr.tenant_code = tsr.tenant_code
       ${metadataJoin}
       WHERE tsr.tenant_code = ?
         AND tsr.subject_id = ?
         AND tsr.status IN ('active', 'suspended')
       ORDER BY tsr.assignment_kind ASC, tr.role_code ASC, tsr.granted_at DESC`,
      [tenantCode, subjectId]
    )
  } catch (error) {
    if (!includeMetadata || !isRoleCatalogMetadataMissingTableError(error)) throw error
    return loadDirectAssignments(tenantCode, subjectId, false)
  }
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
            0 AS active_role_count
     FROM tenant_subjects ts
     ${whereSql}
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

  const activeRoleCounts = await loadActiveRoleCounts(tenantCode, rows)
  const items = rows.map((row) => {
    const uid = row.external_ref || row.subject_code

    return {
      id: row.id,
      tenantCode: row.tenant_code,
      uid,
      subjectCode: row.subject_code,
      displayName: row.display_name || row.subject_code,
      status: row.status,
      activeRoleCount: activeRoleCounts.get(row.id) || 0
    }
  })

  return ok({
    items,
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
  const includeBaseline = queryBooleanValue(query.includeBaseline, true)
  const member = await loadMemberByUid(tenantCode, uid)

  if (!member) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `member not found: ${uid}`
    })
  }

  const [memberships, directAssignments, grantResult] = await Promise.all([
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
    loadDirectAssignments(tenantCode, member.id),
    buildDbAuthorizationGrants(tenantCode, uid, null, {
      activeRoleCode,
      authorizationMode,
      allowRoleSimulation: authorizationMode === 'role_simulation',
      allowUserSimulation: authorizationMode === 'user_simulation',
      includeBaseline
    })
  ])

  const roleRows = await loadRoleRows(tenantCode, grantResult.roleIds)
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
    const roleCode = grant.roleCode || null
    if (roleCode) {
      const roleRow = roleByCode.get(roleCode)
      const role = roleMap.get(roleCode) || {
        roleCode,
        roleName: roleRow?.role_name || roleCode,
        roleType: roleRow?.role_type || 'custom',
        source: roleRow?.source || grant.sourceType,
        category: categorizeRole({
          roleCode,
          roleName: roleRow?.role_name || roleCode,
          description: roleRow?.description,
          source: roleRow?.source || grant.sourceType,
          catalogCategory: roleRow?.catalog_category
        }),
        sourceTypes: new Set<string>(),
        subjectTypes: new Set<string>(),
        permissionCount: 0
      }
      role.sourceTypes.add(grant.sourceType)
      role.subjectTypes.add(grant.subjectType)
      role.permissionCount += 1
      roleMap.set(roleCode, role)
    }

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
      includeBaseline,
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
    directAssignments: directAssignments.map(item => ({
      id: item.id,
      roleId: item.role_id,
      roleCode: item.role_code,
      roleName: item.role_name,
      roleType: item.role_type,
      appCode: item.app_code,
      roleSource: item.role_source,
      category: categorizeRole({
        roleCode: item.role_code,
        roleName: item.role_name,
        description: item.role_description,
        source: item.role_source,
        catalogCategory: item.catalog_category
      }),
      sourceType: item.source_type,
      sourceId: item.source_id,
      assignmentKind: item.assignment_kind,
      reason: item.reason,
      grantedByUid: item.granted_by_uid,
      grantedAt: item.granted_at,
      startsAt: item.starts_at,
      expiredAt: item.expired_at,
      status: item.status,
      active: Boolean(item.active)
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
