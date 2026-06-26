import { isEnterpriseRole, resolveAuthorizationMode, selectEffectiveRoleCodes, type AuthorizationMode } from '@hzy/authz-core'
import {
  evaluateFoundationScopedAuthorization,
  type FoundationObjectContext,
  type FoundationPermissionTriple,
  type FoundationScopePredicate,
  type FoundationScopedAuthorizationDecision,
  type FoundationScopedAuthorizationGrant,
  type FoundationScopedAuthorizationRequirement
} from './scopeEvaluator'

type BundleRecord = Record<string, unknown>

export interface PolicyBundleAllowedAppCodesInput {
  payload: Record<string, unknown> | null | undefined
  uid: string
  requestedRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
}

export interface PolicyBundleAllowedAppCodesResult {
  allowedAppCodes: Set<string>
  availableRoleCodes: string[]
  selectedRoleCodes: string[]
  activeRoleCode: string
  hasActiveUserSubject: boolean
}

export interface PolicyBundleScopedAuthorizationInput {
  payload: Record<string, unknown> | null | undefined
  uid: string
  required: FoundationScopedAuthorizationRequirement
  object?: FoundationObjectContext
  requestedRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
  includeBaseline?: boolean
}

export interface PolicyBundleGrantBuildResult {
  grants: FoundationScopedAuthorizationGrant[]
  availableRoleCodes: string[]
  selectedRoleCodes: string[]
  activeRoleCode: string
  hasActiveUserSubject: boolean
}

export interface PolicyBundleScopedAuthorizationResult extends FoundationScopedAuthorizationDecision {
  grants: FoundationScopedAuthorizationGrant[]
  availableRoleCodes: string[]
  selectedRoleCodes: string[]
  activeRoleCode: string
  hasActiveUserSubject: boolean
}

interface BundleGrantSource {
  roleCode: string
  source: 'direct' | 'template' | 'override'
  grantId: string
  assignmentId?: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function field(record: BundleRecord, camelKey: string, snakeKey: string) {
  return record[camelKey] ?? record[snakeKey]
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function isEnterpriseRoleRecord(role: BundleRecord | null | undefined) {
  if (!role) return false

  return isEnterpriseRole({
    appCode: stringValue(field(role, 'appCode', 'app_code')) || null,
    status: stringValue(role.status) || 'active',
    isAssignable: field(role, 'isAssignable', 'is_assignable') as boolean | number | string | null | undefined
  })
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function isActive(record: BundleRecord) {
  const status = stringValue(record.status)
  return !status || status === 'active'
}

function appMatches(appCode: unknown, targetAppCode: string) {
  const normalized = stringValue(appCode)
  return !normalized || normalized === targetAppCode
}

function optionalFieldMatches(value: unknown, target: string) {
  const normalized = stringValue(value)
  return !normalized || normalized === target
}

function isLegacyConsoleViewerRole(roleCode: string) {
  return roleCode === 'console.viewer'
    || roleCode === 'tenant_console_view'
    || roleCode === 'tenant_console_viewer'
}

function isLegacyConsoleViewerPermission(permission: BundleRecord, roleCode: string) {
  if (!appMatches(permission.appCode, 'console')) return false

  return isLegacyConsoleViewerRole(roleCode)
    || isLegacyConsoleViewerRole(stringValue(permission.appRoleCode))
}

function buildSubjectCodes(uid: string, payload: Record<string, unknown>) {
  const subjectCodes = new Set<string>([uid])
  let hasActiveUserSubject = false

  for (const subject of records(payload.subjects)) {
    if (stringValue(subject.subjectType) !== 'user' || !isActive(subject)) continue

    const subjectCode = stringValue(subject.subjectCode)
    const externalRef = stringValue(subject.externalRef)
    if (subjectCode && (subjectCode === uid || externalRef === uid)) {
      hasActiveUserSubject = true
      subjectCodes.add(subjectCode)
    }
  }

  return { subjectCodes, hasActiveUserSubject }
}

function subjectKey(subjectType: unknown, subjectCode: unknown) {
  const type = stringValue(subjectType)
  const code = stringValue(subjectCode)
  return type && code ? `${type}:${code}` : ''
}

function buildEffectiveSubjectKeys(uid: string, payload: Record<string, unknown>) {
  const { subjectCodes, hasActiveUserSubject } = buildSubjectCodes(uid, payload)
  const effectiveSubjectKeys = new Set<string>()

  for (const subjectCode of subjectCodes) {
    if (subjectCode) effectiveSubjectKeys.add(subjectKey('user', subjectCode))
  }

  for (const membership of records(payload.subjectMemberships)) {
    if (!isActive(membership)) continue
    if (stringValue(membership.subjectType) !== 'user') continue
    if (!subjectCodes.has(stringValue(membership.subjectCode))) continue
    if (!['member', 'manager', 'leader'].includes(stringValue(membership.relationType) || 'member')) continue

    const containerSubjectType = stringValue(membership.containerSubjectType)
    if (!['department', 'job'].includes(containerSubjectType)) continue

    const key = subjectKey(containerSubjectType, membership.containerSubjectCode)
    if (key) effectiveSubjectKeys.add(key)
  }

  return { subjectCodes, effectiveSubjectKeys, hasActiveUserSubject }
}

function addRole(roleSources: Map<string, Set<string>>, roleCode: string, source: string) {
  if (!roleCode) return
  const sources = roleSources.get(roleCode) || new Set<string>()
  sources.add(source)
  roleSources.set(roleCode, sources)
}

function addGrantSource(roleGrantSources: Map<string, BundleGrantSource[]>, grantSource: BundleGrantSource) {
  if (!grantSource.roleCode) return
  const sources = roleGrantSources.get(grantSource.roleCode) || []
  sources.push(grantSource)
  roleGrantSources.set(grantSource.roleCode, sources)
}

function removeTemplateRole(roleSources: Map<string, Set<string>>, roleCode: string) {
  const sources = roleSources.get(roleCode)
  if (!sources) return
  sources.delete('template')
  if (!sources.size) {
    roleSources.delete(roleCode)
  }
}

function removeTemplateGrantSources(roleGrantSources: Map<string, BundleGrantSource[]>, roleCode: string) {
  const sources = roleGrantSources.get(roleCode)
  if (!sources) return
  const remaining = sources.filter(source => source.source !== 'template')
  if (remaining.length) {
    roleGrantSources.set(roleCode, remaining)
  } else {
    roleGrantSources.delete(roleCode)
  }
}

function buildAvailableRoleCodes(
  roleSources: Map<string, Set<string>>,
  roleByCode: Map<string, BundleRecord>
) {
  return [...roleSources.keys()]
    .filter((roleCode) => {
      const role = roleByCode.get(roleCode)
      return role ? isEnterpriseRoleRecord(role) && isActive(role) : false
    })
    .sort((left, right) => {
      const leftRole = roleByCode.get(left)
      const rightRole = roleByCode.get(right)
      return (stringValue(leftRole?.roleName) || left).localeCompare(stringValue(rightRole?.roleName) || right, 'zh-CN')
        || left.localeCompare(right)
    })
}

function buildRoleIndexes(payload: Record<string, unknown>) {
  const roleByCode = new Map<string, BundleRecord>()
  const tenantRoleCodes = new Set<string>()

  for (const role of records(payload.systemRoles)) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      roleByCode.set(roleCode, role)
    }
  }

  for (const role of records(payload.roles)) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      tenantRoleCodes.add(roleCode)
      roleByCode.set(roleCode, role)
    }
  }

  return { roleByCode, tenantRoleCodes }
}

function buildRoleGrantSources(payload: Record<string, unknown>, effectiveSubjectKeys: Set<string>) {
  const roleSources = new Map<string, Set<string>>()
  const roleGrantSources = new Map<string, BundleGrantSource[]>()

  for (const subjectRole of records(payload.subjectRoles)) {
    const key = subjectKey(subjectRole.subjectType, subjectRole.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(subjectRole)) continue

    const roleCode = stringValue(subjectRole.roleCode)
    const assignmentId = stringValue(subjectRole.assignmentId)
    addRole(roleSources, roleCode, 'direct')
    addGrantSource(roleGrantSources, {
      roleCode,
      source: 'direct',
      assignmentId: assignmentId || undefined,
      grantId: assignmentId
        ? `assignment:${assignmentId}`
        : `direct:${stringValue(subjectRole.subjectCode)}:${roleCode}:${stringValue(subjectRole.sourceType)}:${stringValue(subjectRole.sourceId)}`
    })
  }

  const boundTemplateCodes = new Set<string>()
  for (const binding of records(payload.templateBindings)) {
    const key = subjectKey(binding.subjectType, binding.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(binding)) continue

    const templateCode = stringValue(binding.templateCode)
    if (templateCode) boundTemplateCodes.add(templateCode)
  }

  for (const templateRole of records(payload.templateRoles)) {
    const templateCode = stringValue(templateRole.templateCode)
    if (!boundTemplateCodes.has(templateCode)) continue

    const roleCode = stringValue(templateRole.roleCode)
    addRole(roleSources, roleCode, 'template')
    addGrantSource(roleGrantSources, {
      roleCode,
      source: 'template',
      grantId: `template:${templateCode}:${roleCode}`
    })
  }

  for (const override of records(payload.templateOverrides)) {
    const key = subjectKey(override.subjectType, override.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(override)) continue

    const roleCode = stringValue(override.roleCode)
    if (stringValue(override.overrideType) === 'exclude') {
      removeTemplateRole(roleSources, roleCode)
      removeTemplateGrantSources(roleGrantSources, roleCode)
      continue
    }

    addRole(roleSources, roleCode, 'override')
    addGrantSource(roleGrantSources, {
      roleCode,
      source: 'override',
      grantId: `override:${stringValue(override.subjectCode)}:${roleCode}:${stringValue(override.sourceTemplateCode)}`
    })
  }

  return { roleSources, roleGrantSources }
}

function permissionFromRecord(record: BundleRecord): FoundationPermissionTriple | null {
  const appCode = stringValue(record.appCode)
  const resourceCode = stringValue(record.resourceCode)
  const action = stringValue(record.action)
  return appCode && resourceCode && action
    ? { appCode, resourceCode, action }
    : null
}

function permissionKey(permission: FoundationPermissionTriple) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function scopeAppliesToPermission(scope: BundleRecord, permission: FoundationPermissionTriple) {
  return optionalFieldMatches(field(scope, 'appCode', 'app_code'), permission.appCode)
    && optionalFieldMatches(field(scope, 'resourceCode', 'resource_code'), permission.resourceCode)
    && optionalFieldMatches(scope.action, permission.action)
}

const KNOWN_SCOPE_PREDICATES = new Set([
  'global',
  'self',
  'tree',
  'member',
  'owner',
  'team',
  'assigned'
])

function defaultPredicateForDimension(dimension: string, scopeValue: string) {
  if (dimension === 'tenant') return 'global'
  if (dimension === 'department') return 'self'
  if (dimension === 'project') return 'member'
  if (dimension === 'customer') return 'owner'
  if (dimension === 'object') return 'assigned'
  if (dimension === 'relation' || dimension === 'environment') return scopeValue
  return 'equals'
}

function scopePredicateFromRecord(record: BundleRecord, source: FoundationScopePredicate['source']): FoundationScopePredicate | null {
  const dimension = stringValue(field(record, 'scopeDimension', 'scope_dimension'))
    || stringValue(field(record, 'scopeType', 'scope_type'))
  if (!dimension) return null

  const explicitPredicate = stringValue(field(record, 'scopePredicate', 'scope_predicate'))
  const rawValue = stringValue(field(record, 'scopeValue', 'scope_value'))
  let predicate = explicitPredicate
  let value: string | null = explicitPredicate ? nullableString(rawValue) : null

  if (!predicate) {
    if (rawValue.includes(':')) {
      const [rawPredicate, ...rawRest] = rawValue.split(':')
      predicate = stringValue(rawPredicate)
      value = nullableString(rawRest.join(':'))
    } else if (KNOWN_SCOPE_PREDICATES.has(rawValue)) {
      predicate = rawValue
      value = null
    } else {
      predicate = defaultPredicateForDimension(dimension, rawValue)
      value = nullableString(rawValue)
    }
  }

  if (!predicate) return null

  return {
    dimension,
    predicate,
    value,
    group: stringValue(field(record, 'scopeGroup', 'scope_group')) || 'default',
    source
  }
}

function collectRoleDefaultScopes(
  payload: Record<string, unknown>,
  roleCode: string,
  permission: FoundationPermissionTriple,
  tenantRoleCodes: Set<string>
) {
  const scopes: FoundationScopePredicate[] = []

  for (const scope of records(payload.roleScopes)) {
    if (stringValue(scope.roleCode) !== roleCode) continue
    if (!isActive(scope) || !scopeAppliesToPermission(scope, permission)) continue

    const normalized = scopePredicateFromRecord(scope, 'role_default')
    if (normalized) scopes.push(normalized)
  }

  if (!tenantRoleCodes.has(roleCode)) {
    for (const scope of records(payload.systemRoleScopes)) {
      if (stringValue(scope.roleCode) !== roleCode) continue
      if (!isActive(scope) || !scopeAppliesToPermission(scope, permission)) continue

      const normalized = scopePredicateFromRecord(scope, 'role_default')
      if (normalized) scopes.push(normalized)
    }
  }

  return scopes
}

function collectAssignmentScopeRecords(
  payload: Record<string, unknown>,
  assignmentId: string | undefined,
  permission: FoundationPermissionTriple
) {
  if (!assignmentId) return []

  return records(payload.subjectRoleScopes)
    .filter((scope) => {
      if (!isActive(scope)) return false
      if (stringValue(scope.assignmentId) !== assignmentId) return false
      return scopeAppliesToPermission(scope, permission)
    })
}

function assignmentScopeMode(scope: BundleRecord) {
  return stringValue(field(scope, 'scopeMode', 'scope_mode')) || 'intersect'
}

function buildGrantScopes(input: {
  payload: Record<string, unknown>
  grantSource: BundleGrantSource
  permission: FoundationPermissionTriple
  tenantRoleCodes: Set<string>
}) {
  const defaultScopes = collectRoleDefaultScopes(input.payload, input.grantSource.roleCode, input.permission, input.tenantRoleCodes)
  const assignmentScopeRecords = collectAssignmentScopeRecords(input.payload, input.grantSource.assignmentId, input.permission)
  const replaceScopeRecords = assignmentScopeRecords.filter(scope => assignmentScopeMode(scope) === 'replace')

  if (replaceScopeRecords.length) {
    return {
      defaultScopes: [],
      assignmentScopes: replaceScopeRecords
        .map(scope => scopePredicateFromRecord(scope, 'assignment'))
        .filter((scope): scope is FoundationScopePredicate => Boolean(scope))
    }
  }

  return {
    defaultScopes,
    assignmentScopes: assignmentScopeRecords
      .filter(scope => assignmentScopeMode(scope) !== 'inherit')
      .map(scope => scopePredicateFromRecord(scope, 'assignment'))
      .filter((scope): scope is FoundationScopePredicate => Boolean(scope))
  }
}

function collectRolePermissions(
  payload: Record<string, unknown>,
  selectedRoleCodes: Set<string>,
  tenantRoleCodes: Set<string>
) {
  const permissionsByRole = new Map<string, FoundationPermissionTriple[]>()

  function addPermission(roleCode: string, permission: FoundationPermissionTriple) {
    const permissions = permissionsByRole.get(roleCode) || []
    permissions.push(permission)
    permissionsByRole.set(roleCode, permissions)
  }

  for (const record of records(payload.rolePermissions)) {
    const roleCode = stringValue(record.roleCode)
    if (!selectedRoleCodes.has(roleCode)) continue
    if (!isActive(record)) continue

    const permission = permissionFromRecord(record)
    if (permission) addPermission(roleCode, permission)
  }

  for (const record of records(payload.systemRolePermissions)) {
    const roleCode = stringValue(record.roleCode)
    if (!selectedRoleCodes.has(roleCode) || tenantRoleCodes.has(roleCode)) continue
    if (!isActive(record)) continue

    const permission = permissionFromRecord(record)
    if (permission) addPermission(roleCode, permission)
  }

  return permissionsByRole
}

function baselineScopePredicates(permission: BundleRecord) {
  const scope = scopePredicateFromRecord(permission, 'baseline')
  return scope ? [scope] : []
}

export function buildAllowedAppCodesFromPolicyBundle(input: PolicyBundleAllowedAppCodesInput): PolicyBundleAllowedAppCodesResult {
  const payload = input.payload || {}
  const { effectiveSubjectKeys, hasActiveUserSubject } = buildEffectiveSubjectKeys(stringValue(input.uid), payload)
  const roleByCode = new Map<string, BundleRecord>()
  const tenantRoleCodes = new Set<string>()

  for (const role of records(payload.systemRoles)) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      roleByCode.set(roleCode, role)
    }
  }

  for (const role of records(payload.roles)) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      tenantRoleCodes.add(roleCode)
      roleByCode.set(roleCode, role)
    }
  }

  const roleSources = new Map<string, Set<string>>()

  for (const subjectRole of records(payload.subjectRoles)) {
    const key = subjectKey(subjectRole.subjectType, subjectRole.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(subjectRole)) continue
    addRole(roleSources, stringValue(subjectRole.roleCode), 'direct')
  }

  const boundTemplateCodes = new Set<string>()
  for (const binding of records(payload.templateBindings)) {
    const key = subjectKey(binding.subjectType, binding.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(binding)) continue

    const templateCode = stringValue(binding.templateCode)
    if (templateCode) boundTemplateCodes.add(templateCode)
  }

  for (const templateRole of records(payload.templateRoles)) {
    if (!boundTemplateCodes.has(stringValue(templateRole.templateCode))) continue
    addRole(roleSources, stringValue(templateRole.roleCode), 'template')
  }

  for (const override of records(payload.templateOverrides)) {
    const key = subjectKey(override.subjectType, override.subjectCode)
    if (!effectiveSubjectKeys.has(key)) continue
    if (!isActive(override)) continue

    const roleCode = stringValue(override.roleCode)
    if (stringValue(override.overrideType) === 'exclude') {
      removeTemplateRole(roleSources, roleCode)
      continue
    }

    addRole(roleSources, roleCode, 'override')
  }

  const availableRoleCodes = buildAvailableRoleCodes(roleSources, roleByCode)
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes,
    requestedRoleCode: input.requestedRoleCode,
    mode: resolveAuthorizationMode({
      requestedMode: input.authorizationMode,
      allowRoleSimulation: input.allowRoleSimulation,
      allowUserSimulation: input.allowUserSimulation,
      allowPrivileged: input.allowPrivileged
    })
  })
  const selectedRoleCodeSet = new Set(selection.roleCodes)
  const allowedAppCodes = new Set<string>()

  for (const permission of records(payload.rolePermissions)) {
    const roleCode = stringValue(permission.roleCode)
    if (!selectedRoleCodeSet.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode)) continue

    const appCode = stringValue(permission.appCode)
    if (appCode) allowedAppCodes.add(appCode)
  }

  for (const permission of records(payload.systemRolePermissions)) {
    const roleCode = stringValue(permission.roleCode)
    if (!selectedRoleCodeSet.has(roleCode) || tenantRoleCodes.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode)) continue

    const appCode = stringValue(permission.appCode)
    if (appCode) allowedAppCodes.add(appCode)
  }

  if (hasActiveUserSubject) {
    for (const permission of records(payload.baselinePermissions)) {
      const appCode = stringValue(permission.appCode)
      if (appCode === 'console') continue
      if (appCode) allowedAppCodes.add(appCode)
    }
  }

  return {
    allowedAppCodes,
    availableRoleCodes,
    selectedRoleCodes: selection.roleCodes,
    activeRoleCode: selection.activeRoleCode,
    hasActiveUserSubject
  }
}

export function buildScopedAuthorizationGrantsFromPolicyBundle(
  input: Omit<PolicyBundleScopedAuthorizationInput, 'required' | 'object'>
): PolicyBundleGrantBuildResult {
  const payload = input.payload || {}
  const { effectiveSubjectKeys, hasActiveUserSubject } = buildEffectiveSubjectKeys(stringValue(input.uid), payload)
  const { roleByCode, tenantRoleCodes } = buildRoleIndexes(payload)
  const { roleSources, roleGrantSources } = buildRoleGrantSources(payload, effectiveSubjectKeys)
  const availableRoleCodes = buildAvailableRoleCodes(roleSources, roleByCode)
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes,
    requestedRoleCode: input.requestedRoleCode,
    mode: resolveAuthorizationMode({
      requestedMode: input.authorizationMode,
      allowRoleSimulation: input.allowRoleSimulation,
      allowUserSimulation: input.allowUserSimulation,
      allowPrivileged: input.allowPrivileged
    })
  })
  const selectedRoleCodeSet = new Set(selection.roleCodes)
  const permissionsByRole = collectRolePermissions(payload, selectedRoleCodeSet, tenantRoleCodes)
  const grants: FoundationScopedAuthorizationGrant[] = []

  for (const roleCode of selection.roleCodes) {
    const grantSources = roleGrantSources.get(roleCode) || []
    const permissions = permissionsByRole.get(roleCode) || []

    for (const grantSource of grantSources) {
      for (const permission of permissions) {
        const { defaultScopes, assignmentScopes } = buildGrantScopes({
          payload,
          grantSource,
          permission,
          tenantRoleCodes
        })

        grants.push({
          grantId: `${grantSource.grantId}:${permissionKey(permission)}`,
          permissions: [permission],
          defaultScopes,
          assignmentScopes
        })
      }
    }
  }

  if (hasActiveUserSubject && input.includeBaseline !== false) {
    for (const record of records(payload.baselinePermissions)) {
      if (!isActive(record)) continue

      const permission = permissionFromRecord(record)
      if (!permission) continue

      grants.push({
        grantId: `baseline:${permissionKey(permission)}`,
        permissions: [permission],
        scopes: baselineScopePredicates(record)
      })
    }
  }

  return {
    grants,
    availableRoleCodes,
    selectedRoleCodes: selection.roleCodes,
    activeRoleCode: selection.activeRoleCode,
    hasActiveUserSubject
  }
}

export function evaluatePolicyBundleScopedAuthorization(
  input: PolicyBundleScopedAuthorizationInput
): PolicyBundleScopedAuthorizationResult {
  const grantResult = buildScopedAuthorizationGrantsFromPolicyBundle(input)
  const decision = evaluateFoundationScopedAuthorization({
    grants: grantResult.grants,
    required: input.required,
    object: input.object
  })

  return {
    ...decision,
    ...grantResult
  }
}
