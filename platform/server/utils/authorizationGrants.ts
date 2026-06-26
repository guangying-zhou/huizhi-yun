import type { RowDataPacket } from 'mysql2/promise'
import {
  actionSatisfies,
  evaluate,
  grantScopesMatch,
  isActiveAt,
  resolveAuthorizationMode,
  selectEffectiveRoleCodes,
  type AuthorizationContext,
  type AuthorizationGrant,
  type AuthorizationMode,
  type Decision,
  type GrantSource,
  type ObjectContext,
  type PermissionTriple,
  type ScopePredicate
} from '@hzy/authz-core'

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
  assignment_id: number
  subject_id: number
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  source_type: string
  source_id: string | null
  assignment_kind: string
  starts_at: string | Date | null
  expired_at: string | Date | null
}

interface TemplateRoleRow extends RowDataPacket {
  subject_id: number
  subject_type: string
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  template_id: number
  template_code: string
  starts_at: string | Date | null
  expired_at: string | Date | null
}

interface OverrideRow extends RowDataPacket {
  subject_id: number
  subject_type: string
  role_id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  override_type: 'grant' | 'exclude'
  source_template_id: number | null
}

interface PermissionRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
}

interface RoleScopeRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
  scope_type: string
  scope_value: string
}

interface AssignmentScopeRow extends RowDataPacket {
  assignment_id: number
  app_code: string | null
  resource_code: string | null
  action: string | null
  scope_dimension: string
  scope_predicate: string
  scope_value: string | null
  scope_group: string | null
  scope_mode: string
}

interface DbAuthorizationRole {
  roleId: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: {
    type: string
    id: string | number | null
  }
}

interface DbGrantSourceRecord {
  grantId: string
  roleId: number
  roleCode: string
  subjectType: AuthorizationGrant['subjectType']
  sourceType: string
  sourceId: string | number | null
  startsAt?: string | null
  expiresAt?: string | null
  assignmentId?: number
}

export interface DbAuthorizationGrantOptions {
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
}

export interface DbAuthorizationGrantBuildResult {
  uid: string
  tenantCode: string
  subjectId: number | null
  grants: AuthorizationGrant[]
  availableRoleCodes: string[]
  selectedRoleCodes: string[]
  activeRoleCode: string | null
  roleIds: number[]
  assignmentIds: number[]
}

export interface DbAuthorizationEvaluateInput extends DbAuthorizationGrantOptions {
  required: PermissionTriple
  object?: ObjectContext
}

export type DbAuthorizationEvaluateResult = Decision & DbAuthorizationGrantBuildResult

export interface DbAuthorizationExplainInput extends DbAuthorizationGrantOptions {
  required: PermissionTriple
  object?: ObjectContext
}

export interface DbAuthorizationGrantExplanation {
  grantId: string
  roleCode: string | null
  subjectType: AuthorizationGrant['subjectType']
  sourceType: string
  permission: PermissionTriple
  active: boolean
  actionMatched: boolean
  scopeMatched: boolean
  defaultScopes: ScopePredicate[]
  assignmentScopes: ScopePredicate[]
  relationScopes: ScopePredicate[]
}

export type DbAuthorizationExplainResult = Decision & DbAuthorizationGrantBuildResult & {
  matchedGrant: DbAuthorizationGrantExplanation | null
  candidateGrants: DbAuthorizationGrantExplanation[]
}

export interface AuthorizationGrantQueryAdapter {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

const ENTERPRISE_TENANT_ROLE_SQL = `
       AND tr.app_code IS NULL
       AND tr.status = 'active'
       AND tr.is_assignable = 1`

const KNOWN_SCOPE_PREDICATES = new Set([
  'global',
  'self',
  'tree',
  'member',
  'owner',
  'team',
  'assigned'
])

function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return nullableString(value)
}

function inheritedSource(subject: EffectiveSubject) {
  return {
    type: `membership:${subject.subjectType}`,
    id: `${subject.subjectCode}:${subject.relationType || 'member'}`
  }
}

function sourceForSubject(
  subject: EffectiveSubject,
  directSource: { type: string, id: string | number | null }
) {
  return subject.inherited ? inheritedSource(subject) : directSource
}

function grantSubjectType(subject: EffectiveSubject): AuthorizationGrant['subjectType'] {
  if (subject.subjectType === 'department') return 'department'
  if (subject.subjectType === 'job') return 'job'
  if (subject.subjectType === 'project') return 'project'
  return 'user'
}

function optionalFieldMatches(value: unknown, expected: string) {
  const normalized = stringValue(value)
  return !normalized || normalized === expected
}

function permissionKey(permission: PermissionTriple) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function permissionFromRow(row: PermissionRow): PermissionTriple {
  return {
    appCode: row.app_code,
    resourceCode: row.resource_code,
    action: row.action
  }
}

function defaultPredicateForDimension(dimension: string, scopeValue: string) {
  if (dimension === 'tenant') return 'global'
  if (dimension === 'department') return 'self'
  if (dimension === 'project') return 'member'
  if (dimension === 'customer') return 'owner'
  if (dimension === 'object') return 'assigned'
  if (dimension === 'relation' || dimension === 'environment') return scopeValue
  return 'equals'
}

function legacyScopePredicate(scope: RoleScopeRow): ScopePredicate | null {
  const dimension = stringValue(scope.scope_type)
  const rawValue = stringValue(scope.scope_value)
  if (!dimension) return null

  let predicate = ''
  let value: string | null = null
  if (rawValue.includes(':')) {
    const [rawPredicate, ...rawRest] = rawValue.split(':')
    predicate = stringValue(rawPredicate)
    value = nullableString(rawRest.join(':'))
  } else if (KNOWN_SCOPE_PREDICATES.has(rawValue)) {
    predicate = rawValue
  } else {
    predicate = defaultPredicateForDimension(dimension, rawValue)
    value = nullableString(rawValue)
  }

  if (!predicate) return null
  return {
    dimension,
    predicate,
    value,
    group: 'default',
    source: 'role_default'
  }
}

function assignmentScopePredicate(scope: AssignmentScopeRow): ScopePredicate | null {
  const dimension = stringValue(scope.scope_dimension)
  const predicate = stringValue(scope.scope_predicate)
  if (!dimension || !predicate) return null

  return {
    dimension,
    predicate,
    value: nullableString(scope.scope_value),
    group: stringValue(scope.scope_group) || 'default',
    source: 'assignment'
  }
}

function roleScopeAppliesToPermission(scope: RoleScopeRow, permission: PermissionTriple) {
  return scope.app_code === permission.appCode
    && scope.resource_code === permission.resourceCode
    && scope.action === permission.action
}

function assignmentScopeAppliesToPermission(scope: AssignmentScopeRow, permission: PermissionTriple) {
  return optionalFieldMatches(scope.app_code, permission.appCode)
    && optionalFieldMatches(scope.resource_code, permission.resourceCode)
    && optionalFieldMatches(scope.action, permission.action)
}

function addRole(
  roleById: Map<number, DbAuthorizationRole>,
  role: DbAuthorizationRole
) {
  if (!roleById.has(role.roleId)) {
    roleById.set(role.roleId, role)
  }
}

function addGrantSource(
  sourcesByRoleId: Map<number, DbGrantSourceRecord[]>,
  source: DbGrantSourceRecord
) {
  const sources = sourcesByRoleId.get(source.roleId) || []
  sources.push(source)
  sourcesByRoleId.set(source.roleId, sources)
}

function removeTemplateGrantSources(
  roleById: Map<number, DbAuthorizationRole>,
  sourcesByRoleId: Map<number, DbGrantSourceRecord[]>,
  roleId: number
) {
  const remaining = (sourcesByRoleId.get(roleId) || []).filter(source => source.sourceType !== 'template')
  if (remaining.length) {
    sourcesByRoleId.set(roleId, remaining)
    return
  }

  sourcesByRoleId.delete(roleId)
  if (roleById.get(roleId)?.source.type === 'template') {
    roleById.delete(roleId)
  }
}

function pushScope(target: ScopePredicate[], scope: ScopePredicate | null) {
  if (scope) target.push(scope)
}

function buildGrantScopes(input: {
  source: DbGrantSourceRecord
  permission: PermissionTriple
  roleScopes: RoleScopeRow[]
  assignmentScopes: AssignmentScopeRow[]
}) {
  const defaultScopes: ScopePredicate[] = []
  const assignmentScopes: ScopePredicate[] = []

  for (const scope of input.roleScopes) {
    if (scope.role_id !== input.source.roleId) continue
    if (!roleScopeAppliesToPermission(scope, input.permission)) continue
    pushScope(defaultScopes, legacyScopePredicate(scope))
  }

  if (!input.source.assignmentId) {
    return { defaultScopes, assignmentScopes }
  }

  const assignmentScopeRows = input.assignmentScopes.filter(scope =>
    scope.assignment_id === input.source.assignmentId
    && assignmentScopeAppliesToPermission(scope, input.permission)
  )
  const replaceScopes = assignmentScopeRows.filter(scope => stringValue(scope.scope_mode) === 'replace')
  const scopedRows = replaceScopes.length
    ? replaceScopes
    : assignmentScopeRows.filter(scope => stringValue(scope.scope_mode) !== 'inherit')

  for (const scope of scopedRows) {
    pushScope(assignmentScopes, assignmentScopePredicate(scope))
  }

  return {
    defaultScopes: replaceScopes.length ? [] : defaultScopes,
    assignmentScopes
  }
}

async function findUserSubject(
  queries: AuthorizationGrantQueryAdapter,
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
  queries: AuthorizationGrantQueryAdapter,
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

async function loadRoleSources(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  subjectIds: number[]
) {
  const subjectPlaceholders = subjectIds.map(() => '?').join(', ')
  const directRoles = await queries.queryRows<DirectRoleRow[]>(
    `SELECT tsr.id AS assignment_id,
            tsr.subject_id,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tsr.source_type, tsr.source_id, tsr.assignment_kind, tsr.starts_at, tsr.expired_at
     FROM tenant_subject_roles tsr
     INNER JOIN tenant_roles tr
       ON tr.id = tsr.role_id
      AND tr.tenant_code = tsr.tenant_code
     WHERE tsr.tenant_code = ?
       AND tsr.subject_id IN (${subjectPlaceholders})
       AND tsr.status = 'active'
       AND (tsr.starts_at IS NULL OR tsr.starts_at <= UTC_TIMESTAMP())
       AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...subjectIds]
  )

  const templateRoles = await queries.queryRows<TemplateRoleRow[]>(
    `SELECT ttb.subject_id, ttb.subject_type,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tpt.id AS template_id, tpt.template_code,
            ttb.start_at AS starts_at, ttb.end_at AS expired_at
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
       AND ttb.subject_id IN (${subjectPlaceholders})
       AND ttb.status = 'active'
       AND (ttb.start_at IS NULL OR ttb.start_at <= UTC_TIMESTAMP())
       AND (ttb.end_at IS NULL OR ttb.end_at > UTC_TIMESTAMP())
       AND tpt.status = 'active'
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...subjectIds]
  )

  const overrides = await queries.queryRows<OverrideRow[]>(
    `SELECT tto.subject_id, tto.subject_type,
            tr.id AS role_id, tr.role_code, tr.role_name, tr.role_type, tr.app_code,
            tto.override_type, tto.source_template_id
     FROM tenant_template_overrides tto
     INNER JOIN tenant_roles tr
      ON tr.id = tto.role_id
     AND tr.tenant_code = tto.tenant_code
     WHERE tto.tenant_code = ?
       AND tto.subject_id IN (${subjectPlaceholders})
       AND tto.status = 'active'
       AND tr.status = 'active'
       ${ENTERPRISE_TENANT_ROLE_SQL}`,
    [tenantCode, ...subjectIds]
  )

  return { directRoles, templateRoles, overrides }
}

async function loadRolePermissions(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  roleIds: number[],
  appCode?: string | null
) {
  const inPlaceholders = roleIds.map(() => '?').join(', ')
  return queries.queryRows<PermissionRow[]>(
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
}

async function loadRoleScopes(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  roleIds: number[],
  appCode?: string | null
) {
  const inPlaceholders = roleIds.map(() => '?').join(', ')
  return queries.queryRows<RoleScopeRow[]>(
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
}

async function loadAssignmentScopes(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  assignmentIds: number[],
  appCode?: string | null
) {
  if (!assignmentIds.length) return []

  const inPlaceholders = assignmentIds.map(() => '?').join(', ')
  return queries.queryRows<AssignmentScopeRow[]>(
    `SELECT assignment_id, app_code, resource_code, action,
            scope_dimension, scope_predicate, scope_value, scope_group, scope_mode
     FROM tenant_subject_role_scopes
     WHERE tenant_code = ?
       AND assignment_id IN (${inPlaceholders})
       AND status = 'active'
       ${appCode ? 'AND (app_code IS NULL OR app_code = ?)' : ''}`,
    appCode
      ? [tenantCode, ...assignmentIds, appCode]
      : [tenantCode, ...assignmentIds]
  )
}

export async function buildDbAuthorizationGrantsWithQueries(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  uid: string,
  appCode?: string | null,
  options: DbAuthorizationGrantOptions = {}
): Promise<DbAuthorizationGrantBuildResult> {
  const userSubject = await findUserSubject(queries, tenantCode, uid)
  if (!userSubject) {
    return {
      uid,
      tenantCode,
      subjectId: null,
      grants: [],
      availableRoleCodes: [],
      selectedRoleCodes: [],
      activeRoleCode: null,
      roleIds: [],
      assignmentIds: []
    }
  }

  const roleById = new Map<number, DbAuthorizationRole>()
  const sourcesByRoleId = new Map<number, DbGrantSourceRecord[]>()
  const effectiveSubjects = await loadEffectiveSubjects(queries, tenantCode, userSubject)
  const userEffectiveSubject = effectiveSubjects[0] as EffectiveSubject
  const effectiveSubjectById = new Map(effectiveSubjects.map(subject => [subject.id, subject]))
  const { directRoles, templateRoles, overrides } = await loadRoleSources(
    queries,
    tenantCode,
    effectiveSubjects.map(subject => subject.id)
  )

  for (const role of directRoles) {
    const subject = effectiveSubjectById.get(role.subject_id) || userEffectiveSubject
    addRole(roleById, {
      roleId: role.role_id,
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      appCode: role.app_code,
      source: sourceForSubject(subject, { type: role.source_type, id: role.source_id })
    })
    addGrantSource(sourcesByRoleId, {
      grantId: `subject-role:${role.assignment_id}`,
      roleId: role.role_id,
      roleCode: role.role_code,
      subjectType: grantSubjectType(subject),
      sourceType: subject.inherited ? `membership:${subject.subjectType}` : (role.source_type || 'manual'),
      sourceId: subject.inherited ? inheritedSource(subject).id : role.source_id,
      startsAt: dateValue(role.starts_at),
      expiresAt: dateValue(role.expired_at),
      assignmentId: role.assignment_id
    })
  }

  for (const role of templateRoles) {
    const subject = effectiveSubjectById.get(role.subject_id) || userEffectiveSubject
    addRole(roleById, {
      roleId: role.role_id,
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      appCode: role.app_code,
      source: sourceForSubject(subject, { type: 'template', id: role.template_code })
    })
    addGrantSource(sourcesByRoleId, {
      grantId: `template:${role.template_id}:${role.role_id}:${role.subject_id}`,
      roleId: role.role_id,
      roleCode: role.role_code,
      subjectType: grantSubjectType(subject),
      sourceType: subject.inherited ? `membership:${subject.subjectType}:template` : 'template',
      sourceId: subject.inherited ? `${inheritedSource(subject).id}:${role.template_code}` : role.template_code,
      startsAt: dateValue(role.starts_at),
      expiresAt: dateValue(role.expired_at)
    })
  }

  for (const override of overrides) {
    if (override.override_type === 'exclude') {
      removeTemplateGrantSources(roleById, sourcesByRoleId, override.role_id)
      continue
    }

    const subject = effectiveSubjectById.get(override.subject_id) || userEffectiveSubject
    addRole(roleById, {
      roleId: override.role_id,
      roleCode: override.role_code,
      roleName: override.role_name,
      roleType: override.role_type,
      appCode: override.app_code,
      source: sourceForSubject(subject, { type: 'override_grant', id: override.source_template_id })
    })
    addGrantSource(sourcesByRoleId, {
      grantId: `override:${override.source_template_id || 'manual'}:${override.role_id}:${override.subject_id}`,
      roleId: override.role_id,
      roleCode: override.role_code,
      subjectType: grantSubjectType(subject),
      sourceType: subject.inherited ? `membership:${subject.subjectType}:override_grant` : 'override_grant',
      sourceId: subject.inherited ? `${inheritedSource(subject).id}:${override.source_template_id || 'manual'}` : override.source_template_id
    })
  }

  const availableRoles = [...roleById.values()]
    .filter(role => (sourcesByRoleId.get(role.roleId) || []).length > 0)
    .sort((left, right) => left.roleName.localeCompare(right.roleName, 'zh-CN') || left.roleCode.localeCompare(right.roleCode))
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: availableRoles.map(role => role.roleCode),
    requestedRoleCode: options.activeRoleCode,
    mode: resolveAuthorizationMode({
      requestedMode: options.authorizationMode,
      allowRoleSimulation: options.allowRoleSimulation,
      allowUserSimulation: options.allowUserSimulation,
      allowPrivileged: options.allowPrivileged
    })
  })
  const selectedRoleCodeSet = new Set(selection.roleCodes)
  const selectedRoleIds = availableRoles
    .filter(role => selectedRoleCodeSet.has(role.roleCode))
    .map(role => role.roleId)
  const selectedGrantSources = selectedRoleIds.flatMap(roleId => sourcesByRoleId.get(roleId) || [])

  if (!selectedRoleIds.length || !selectedGrantSources.length) {
    return {
      uid,
      tenantCode,
      subjectId: userSubject.id,
      grants: [],
      availableRoleCodes: availableRoles.map(role => role.roleCode),
      selectedRoleCodes: selection.roleCodes,
      activeRoleCode: selection.activeRoleCode || null,
      roleIds: [],
      assignmentIds: []
    }
  }

  const permissions = await loadRolePermissions(queries, tenantCode, selectedRoleIds, appCode)
  const roleScopes = await loadRoleScopes(queries, tenantCode, selectedRoleIds, appCode)
  const assignmentIds = [...new Set(selectedGrantSources
    .map(source => source.assignmentId)
    .filter((assignmentId): assignmentId is number => typeof assignmentId === 'number' && assignmentId > 0))]
  const assignmentScopes = await loadAssignmentScopes(queries, tenantCode, assignmentIds, appCode)
  const permissionsByRoleId = new Map<number, PermissionTriple[]>()

  for (const row of permissions) {
    const items = permissionsByRoleId.get(row.role_id) || []
    items.push(permissionFromRow(row))
    permissionsByRoleId.set(row.role_id, items)
  }

  const grants: AuthorizationGrant[] = []
  for (const source of selectedGrantSources) {
    for (const permission of permissionsByRoleId.get(source.roleId) || []) {
      const scopes = buildGrantScopes({
        source,
        permission,
        roleScopes,
        assignmentScopes
      })

      grants.push({
        grantId: `${source.grantId}:${permissionKey(permission)}`,
        subjectType: source.subjectType,
        roleCode: source.roleCode,
        sourceType: source.sourceType,
        startsAt: source.startsAt,
        expiresAt: source.expiresAt,
        permission,
        defaultScopes: scopes.defaultScopes,
        assignmentScopes: scopes.assignmentScopes,
        scopes: []
      })
    }
  }

  return {
    uid,
    tenantCode,
    subjectId: userSubject.id,
    grants,
    availableRoleCodes: availableRoles.map(role => role.roleCode),
    selectedRoleCodes: selection.roleCodes,
    activeRoleCode: selection.activeRoleCode || null,
    roleIds: selectedRoleIds,
    assignmentIds
  }
}

export async function evaluateDbAuthorizationWithQueries(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  uid: string,
  appCode: string,
  input: DbAuthorizationEvaluateInput
): Promise<DbAuthorizationEvaluateResult> {
  const grantResult = await buildDbAuthorizationGrantsWithQueries(queries, tenantCode, uid, appCode, input)
  const decision = evaluate({
    grants: grantResult.grants,
    required: input.required,
    object: input.object
  })

  return {
    ...grantResult,
    ...decision
  }
}

function explainGrant(input: {
  grant: AuthorizationGrant
  required: PermissionTriple
  object?: ObjectContext
  now: Date
}): DbAuthorizationGrantExplanation {
  const active = isActiveAt(input.grant, input.now)
  const actionMatched = input.grant.permission.appCode === input.required.appCode
    && input.grant.permission.resourceCode === input.required.resourceCode
    && actionSatisfies(input.grant.permission.action, input.required.action)

  return {
    grantId: input.grant.grantId,
    roleCode: input.grant.roleCode || null,
    subjectType: input.grant.subjectType,
    sourceType: input.grant.sourceType,
    permission: input.grant.permission,
    active,
    actionMatched,
    scopeMatched: active && actionMatched && grantScopesMatch(input.grant, input.object),
    defaultScopes: input.grant.defaultScopes || [],
    assignmentScopes: input.grant.assignmentScopes || [],
    relationScopes: input.grant.scopes || []
  }
}

export async function explainDbAuthorizationWithQueries(
  queries: AuthorizationGrantQueryAdapter,
  tenantCode: string,
  uid: string,
  appCode: string,
  input: DbAuthorizationExplainInput
): Promise<DbAuthorizationExplainResult> {
  const grantResult = await buildDbAuthorizationGrantsWithQueries(queries, tenantCode, uid, appCode, input)
  const now = new Date()
  const decision = evaluate({
    grants: grantResult.grants,
    required: input.required,
    object: input.object,
    now
  })
  const grantExplanations = grantResult.grants.map(grant => explainGrant({
    grant,
    required: input.required,
    object: input.object,
    now
  }))
  const candidateGrants = grantExplanations.filter(grant => grant.active && grant.actionMatched)
  const matchedGrant = decision.matchedGrantId
    ? candidateGrants.find(grant => grant.grantId === decision.matchedGrantId) || null
    : null

  return {
    ...grantResult,
    ...decision,
    matchedGrant,
    candidateGrants
  }
}

export class DbGrantSource implements GrantSource {
  private queries: AuthorizationGrantQueryAdapter
  private appCode?: string | null
  private requestedRoleCode?: string | null

  constructor(queries: AuthorizationGrantQueryAdapter, options: { appCode?: string | null, requestedRoleCode?: string | null } = {}) {
    this.queries = queries
    this.appCode = options.appCode
    this.requestedRoleCode = options.requestedRoleCode
  }

  async loadGrants(ctx: AuthorizationContext): Promise<AuthorizationGrant[]> {
    const result = await buildDbAuthorizationGrantsWithQueries(
      this.queries,
      ctx.tenantCode,
      ctx.actorUid,
      this.appCode,
      {
        activeRoleCode: this.requestedRoleCode,
        authorizationMode: ctx.mode,
        allowRoleSimulation: ctx.mode === 'role_simulation',
        allowUserSimulation: ctx.mode === 'user_simulation',
        allowPrivileged: ctx.mode === 'privileged'
      }
    )

    return result.grants
  }
}
