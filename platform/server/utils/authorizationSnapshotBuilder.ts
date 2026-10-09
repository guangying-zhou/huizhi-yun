import type { RowDataPacket } from 'mysql2/promise'
import { resolveAuthorizationMode, selectEffectiveRoleCodes, type AuthorizationMode } from '@hzy/authz-core'

interface SubjectRow extends RowDataPacket {
  id: number
  tenant_code: string
  subject_type: string
  subject_code: string
  display_name: string | null
  external_ref: string | null
}

interface EffectiveSubjectRow extends RowDataPacket {
  id: number
  subject_type: string
  subject_code: string
  relation_type: string
}

interface EffectiveSubject {
  id: number
  subjectType: string
  subjectCode: string
  relationType: string | null
  inherited: boolean
}

interface DirectRoleRow extends RowDataPacket {
  subject_id: number
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  tenant_role_source: string | null
  source_role_code: string | null
  source_type: string
  source_id: string | null
  assignment_kind: string
}

interface TemplateRoleRow extends RowDataPacket {
  subject_id: number
  subject_type: string
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  tenant_role_source: string | null
  source_role_code: string | null
  template_id: number
  template_code: string
}

interface OverrideRow extends RowDataPacket {
  subject_id: number
  subject_type: string
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  tenant_role_source: string | null
  source_role_code: string | null
  override_type: 'grant' | 'exclude'
  source_template_id: number | null
}

interface PermissionRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
}

interface ScopeRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
  scope_type: string
  scope_value: string
}

interface SnapshotAuthorizationRole {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: {
    type: string
    id: string | number | null
  }
}

interface SnapshotAuthorizationPermission {
  appCode: string
  resourceCode: string
  action: string
}

interface SnapshotAuthorizationScope {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
}

interface SnapshotAuthorizationSnapshot {
  uid: string
  tenantCode: string
  roles: SnapshotAuthorizationRole[]
  availableRoles?: SnapshotAuthorizationRole[]
  activeRoleCode?: string | null
  permissions: SnapshotAuthorizationPermission[]
  scopes: SnapshotAuthorizationScope[]
  sources: Array<{ type: string, id: string | number | null }>
}

interface SnapshotAuthorizationOptions {
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
}

export interface AuthorizationQueryAdapter {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

const ENTERPRISE_TENANT_ROLE_SQL = `
       AND tr.app_code IS NULL
       AND tr.status = 'active'
       AND tr.is_assignable = 1`

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function sourceForSubject(
  subject: EffectiveSubject,
  directSource: { type: string, id: string | number | null }
) {
  if (!subject.inherited) {
    return directSource
  }

  return {
    type: `membership:${subject.subjectType}`,
    id: `${subject.subjectCode}:${subject.relationType || 'member'}`
  }
}

async function findUserSubject(
  queries: AuthorizationQueryAdapter,
  tenantCode: string,
  uid: string
) {
  return queries.queryRow<SubjectRow>(
    `SELECT id, tenant_code, subject_type, subject_code, display_name, external_ref
     FROM tenant_subjects
     WHERE tenant_code = ?
       AND subject_type = 'user'
       AND (subject_code = ? OR external_ref = ?)
       AND status = 'active'
     LIMIT 1`,
    [tenantCode, uid, uid]
  )
}

async function loadEffectiveSubjects(
  queries: AuthorizationQueryAdapter,
  tenantCode: string,
  userSubject: SubjectRow
): Promise<EffectiveSubject[]> {
  const inheritedSubjects = await queries.queryRows<EffectiveSubjectRow[]>(
    `SELECT container.id, container.subject_type, container.subject_code, tsm.relation_type
     FROM tenant_subject_memberships tsm
     INNER JOIN tenant_subjects container
       ON container.id = tsm.container_subject_id
      AND container.tenant_code = tsm.tenant_code
      AND container.status = 'active'
     WHERE tsm.tenant_code = ?
       AND tsm.subject_id = ?
       AND tsm.status = 'active'
       AND tsm.relation_type IN ('member', 'manager', 'leader')
       AND container.subject_type IN ('department', 'job')
     ORDER BY container.subject_type, container.subject_code, tsm.relation_type`,
    [tenantCode, userSubject.id]
  )

  return [
    {
      id: userSubject.id,
      subjectType: 'user',
      subjectCode: userSubject.subject_code,
      relationType: null,
      inherited: false
    },
    ...inheritedSubjects.map(subject => ({
      id: subject.id,
      subjectType: subject.subject_type,
      subjectCode: subject.subject_code,
      relationType: subject.relation_type,
      inherited: true
    }))
  ]
}

export async function buildAuthorizationSnapshotWithQueries(
  queries: AuthorizationQueryAdapter,
  tenantCode: string,
  uid: string,
  appCode?: string | null,
  options: SnapshotAuthorizationOptions = {}
): Promise<SnapshotAuthorizationSnapshot> {
  const userSubject = await findUserSubject(queries, tenantCode, uid)

  if (!userSubject) {
    return {
      uid,
      tenantCode,
      roles: [],
      permissions: [],
      scopes: [],
      sources: []
    }
  }

  const effectiveSubjects = await loadEffectiveSubjects(queries, tenantCode, userSubject)
  const userEffectiveSubject = effectiveSubjects[0] as EffectiveSubject
  const effectiveSubjectById = new Map(effectiveSubjects.map(subject => [subject.id, subject]))
  const effectiveSubjectIds = effectiveSubjects.map(subject => subject.id)
  const effectiveSubjectPlaceholders = effectiveSubjectIds.map(() => '?').join(', ')

  const directRoles = await queries.queryRows<DirectRoleRow[]>(
    `SELECT tsr.subject_id,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tr.source AS tenant_role_source, tr.source_role_code,
            tsr.source_type, tsr.source_id, tsr.assignment_kind
     FROM tenant_subject_roles tsr
     INNER JOIN tenant_roles tr
       ON tr.id = tsr.role_id
      AND tr.tenant_code = tsr.tenant_code
     WHERE tsr.tenant_code = ?
       AND tsr.subject_id IN (${effectiveSubjectPlaceholders})
       AND tsr.status = 'active'
       AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
       AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...effectiveSubjectIds]
  )

  const templateRoles = await queries.queryRows<TemplateRoleRow[]>(
    `SELECT ttb.subject_id, ttb.subject_type,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tr.source AS tenant_role_source, tr.source_role_code,
            tpt.id AS template_id, tpt.template_code
     FROM tenant_template_bindings ttb
     INNER JOIN tenant_permission_templates tpt
       ON tpt.id = ttb.template_id
      AND tpt.tenant_code = ttb.tenant_code
     INNER JOIN tenant_template_roles ttr
       ON ttr.template_id = tpt.id
      AND ttr.tenant_code = tpt.tenant_code
     INNER JOIN tenant_roles tr
      ON tr.id = ttr.role_id
     AND tr.tenant_code = ttr.tenant_code
     WHERE ttb.tenant_code = ?
       AND ttb.subject_id IN (${effectiveSubjectPlaceholders})
       AND ttb.status = 'active'
       AND (ttb.start_at IS NULL OR ttb.start_at <= UTC_TIMESTAMP())
       AND (ttb.end_at IS NULL OR ttb.end_at > UTC_TIMESTAMP())
       AND tpt.status = 'active'
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...effectiveSubjectIds]
  )

  const overrides = await queries.queryRows<OverrideRow[]>(
    `SELECT tto.subject_id, tto.subject_type,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tr.source AS tenant_role_source, tr.source_role_code,
            tto.override_type, tto.source_template_id
     FROM tenant_template_overrides tto
     INNER JOIN tenant_roles tr
      ON tr.id = tto.role_id
     AND tr.tenant_code = tto.tenant_code
     WHERE tto.tenant_code = ?
       AND tto.subject_id IN (${effectiveSubjectPlaceholders})
       AND tto.status = 'active'
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...effectiveSubjectIds]
  )

  const roleMap = new Map<number, SnapshotAuthorizationRole>()

  for (const role of directRoles) {
    const subject = effectiveSubjectById.get(role.subject_id) || userEffectiveSubject
    roleMap.set(role.role_id, {
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      appCode: role.app_code,
      source: sourceForSubject(subject, {
        type: role.source_type,
        id: role.source_id
      })
    })
  }

  for (const role of templateRoles) {
    if (!roleMap.has(role.role_id)) {
      const subject = effectiveSubjectById.get(role.subject_id) || userEffectiveSubject
      roleMap.set(role.role_id, {
        roleCode: role.role_code,
        roleName: role.role_name,
        roleType: role.role_type,
        appCode: role.app_code,
        source: sourceForSubject(subject, {
          type: 'template',
          id: role.template_code
        })
      })
    }
  }

  for (const override of overrides) {
    if (override.override_type === 'exclude') {
      const existing = roleMap.get(override.role_id)
      if (existing && existing.source.type === 'template') {
        roleMap.delete(override.role_id)
      }
      continue
    }

    if (!roleMap.has(override.role_id)) {
      const subject = effectiveSubjectById.get(override.subject_id) || userEffectiveSubject
      roleMap.set(override.role_id, {
        roleCode: override.role_code,
        roleName: override.role_name,
        roleType: override.role_type,
        appCode: override.app_code,
        source: sourceForSubject(subject, {
          type: 'override_grant',
          id: override.source_template_id
        })
      })
    }
  }

  const availableRoles = [...roleMap.values()]
    .sort((left, right) => left.roleName.localeCompare(right.roleName, 'zh-CN') || left.roleCode.localeCompare(right.roleCode))
  const requestedActiveRoleCode = stringValue(options.activeRoleCode)
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: availableRoles.map(role => role.roleCode),
    requestedRoleCode: requestedActiveRoleCode,
    mode: resolveAuthorizationMode({
      requestedMode: options.authorizationMode,
      allowRoleSimulation: options.allowRoleSimulation,
      allowUserSimulation: options.allowUserSimulation,
      allowPrivileged: options.allowPrivileged
    })
  })
  const selectedRoleCodeSet = new Set(selection.roleCodes)
  const selectedRoles = availableRoles.filter(role => selectedRoleCodeSet.has(role.roleCode))
  const roleIds = selectedRoleCodeSet.size
    ? [...roleMap.entries()].filter(([, role]) => selectedRoleCodeSet.has(role.roleCode)).map(([roleId]) => roleId)
    : []
  if (!roleIds.length) {
    return {
      uid,
      tenantCode,
      roles: [],
      availableRoles,
      activeRoleCode: null,
      permissions: [],
      scopes: [],
      sources: []
    }
  }

  const inPlaceholders = roleIds.map(() => '?').join(', ')

  const permissions = await queries.queryRows<PermissionRow[]>(
    `SELECT role_id, app_code, resource_code, action
     FROM tenant_role_permissions
     WHERE tenant_code = ?
       AND role_id IN (${inPlaceholders})
       ${appCode ? 'AND app_code = ?' : ''}
     UNION ALL
     SELECT tram.role_id, arp.app_code, arp.resource_code, arp.action
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE tram.tenant_code = ?
       AND tram.role_id IN (${inPlaceholders})
       ${appCode ? 'AND arp.app_code = ?' : ''}`,
    appCode
      ? [tenantCode, ...roleIds, appCode, tenantCode, ...roleIds, appCode]
      : [tenantCode, ...roleIds, tenantCode, ...roleIds]
  )

  const scopes = await queries.queryRows<ScopeRow[]>(
    `SELECT role_id, app_code, resource_code, action, scope_type, scope_value
     FROM tenant_role_scopes
     WHERE tenant_code = ?
       AND role_id IN (${inPlaceholders})
       AND status = 'active'
       ${appCode ? 'AND app_code = ?' : ''}
     UNION ALL
     SELECT tram.role_id, ars.app_code, ars.resource_code, ars.action, ars.scope_type, ars.scope_value
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE tram.tenant_code = ?
       AND tram.role_id IN (${inPlaceholders})
       ${appCode ? 'AND ars.app_code = ?' : ''}`,
    appCode
      ? [tenantCode, ...roleIds, appCode, tenantCode, ...roleIds, appCode]
      : [tenantCode, ...roleIds, tenantCode, ...roleIds]
  )

  return {
    uid,
    tenantCode,
    roles: selectedRoles,
    availableRoles,
    activeRoleCode: selection.activeRoleCode || null,
    permissions: permissions.map(permission => ({
      appCode: permission.app_code,
      resourceCode: permission.resource_code,
      action: permission.action
    })),
    scopes: scopes.map(scope => ({
      appCode: scope.app_code,
      resourceCode: scope.resource_code,
      action: scope.action,
      scopeType: scope.scope_type,
      scopeValue: scope.scope_value
    })),
    sources: selectedRoles.map(role => role.source)
  }
}
