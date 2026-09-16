export const POLICY_BUNDLE_V2_SCHEMA_VERSION = 'policy-bundle.v2'
export const POLICY_BUNDLE_COMPAT_SCHEMA_VERSIONS = [POLICY_BUNDLE_V2_SCHEMA_VERSION]
export const LEGACY_POLICY_BUNDLE_AUTHORIZATION_FIELDS = [
  'subjectRoles',
  'subjectRoleScopes',
  'rolePermissions',
  'roleScopes',
  'baselinePermissions'
] as const

export const DEFAULT_ACTION_IMPLICATIONS = [
  {
    action: 'edit',
    implies: ['view'],
    source: 'platform-default',
    scope: 'global'
  },
  {
    action: 'admin',
    implies: ['view', 'edit'],
    source: 'platform-default',
    scope: 'global'
  }
]

function recordValue(row: unknown) {
  return (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
}

function nullableString(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function normalizedStatus(value: unknown) {
  return nullableString(value) || 'active'
}

function normalizedPolicyRevision(value: unknown) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => nullableString(item)).filter((item): item is string => Boolean(item))
    : []
}

export function normalizeManifestActionImplications(items: unknown[] = []) {
  const grouped = new Map<string, {
    appCode: string
    resourceCode: string
    action: string
    implies: Set<string>
    source: string
    scope: string
  }>()

  for (const item of items) {
    const row = recordValue(item)
    const appCode = nullableString(row.appCode)
    const resourceCode = nullableString(row.resourceCode)
    const action = nullableString(row.action)
    const implies = stringArray(row.implies)
    if (!appCode || !resourceCode || !action || !implies.length) continue

    const key = `${appCode}:${resourceCode}:${action}`
    const existing = grouped.get(key) || {
      appCode,
      resourceCode,
      action,
      implies: new Set<string>(),
      source: nullableString(row.source) || 'app-manifest',
      scope: 'resource'
    }
    for (const impliedAction of implies) existing.implies.add(impliedAction)
    grouped.set(key, existing)
  }

  return [...grouped.values()].map(item => ({
    appCode: item.appCode,
    resourceCode: item.resourceCode,
    action: item.action,
    implies: [...item.implies].sort(),
    source: item.source,
    scope: item.scope
  })).sort((left, right) => (
    left.appCode.localeCompare(right.appCode)
    || left.resourceCode.localeCompare(right.resourceCode)
    || left.action.localeCompare(right.action)
  ))
}

function baselineGrantId(row: Record<string, unknown>) {
  return [
    'baseline',
    nullableString(row.appCode) || '',
    nullableString(row.resourceCode) || '',
    nullableString(row.action) || '',
    nullableString(row.scopeType) || '',
    nullableString(row.scopeValue) || ''
  ].join(':')
}

function rolePermissionGrantId(row: Record<string, unknown>) {
  return [
    'role-permission',
    nullableString(row.roleCode) || '',
    nullableString(row.appCode) || '',
    nullableString(row.resourceCode) || '',
    nullableString(row.action) || '',
    nullableString(row.sourceType) || '',
    nullableString(row.appRoleCode) || '',
    nullableString(row.sourceManifestActionId ?? row.manifestActionId) || ''
  ].join(':')
}

export function buildPolicyBundleV2CompatFields(input: {
  tenantCode: string
  environment: string
  subjectRoles: unknown[]
  subjectRoleScopes: unknown[]
  rolePermissions?: unknown[]
  roleScopes: unknown[]
  baselinePermissions: unknown[]
  conflictRules: unknown[]
  actionImplications?: unknown[]
  policyRevision?: unknown
}) {
  const roleAssignments = input.subjectRoles.map((item) => {
    const row = recordValue(item)
    return {
      assignmentId: row.assignmentId,
      subjectType: row.subjectType,
      subjectCode: row.subjectCode,
      roleCode: row.roleCode,
      assignmentKind: nullableString(row.assignmentKind) || 'manual',
      sourceType: nullableString(row.sourceType) || 'manual',
      sourceId: nullableString(row.sourceId),
      grantedAt: row.grantedAt ?? null,
      startsAt: row.startsAt ?? null,
      expiresAt: row.expiresAt ?? row.expiredAt ?? null,
      status: normalizedStatus(row.status)
    }
  })

  const rolePermissionGrants = (input.rolePermissions || []).map((item) => {
    const row = recordValue(item)
    return {
      grantId: rolePermissionGrantId(row),
      roleCode: row.roleCode,
      appCode: row.appCode,
      resourceCode: row.resourceCode,
      action: row.action,
      sourceManifestActionId: row.sourceManifestActionId ?? row.manifestActionId ?? null,
      sourceType: nullableString(row.sourceType) || 'custom',
      appRoleCode: nullableString(row.appRoleCode),
      status: normalizedStatus(row.status)
    }
  })

  const assignmentScopes = input.subjectRoleScopes.map((item) => {
    const row = recordValue(item)
    return {
      assignmentId: row.assignmentId,
      subjectType: row.subjectType,
      subjectCode: row.subjectCode,
      roleCode: row.roleCode,
      sourceType: nullableString(row.sourceType) || 'manual',
      sourceId: nullableString(row.sourceId),
      appCode: row.appCode,
      resourceCode: row.resourceCode,
      action: row.action,
      scopeDimension: row.scopeDimension,
      scopePredicate: row.scopePredicate,
      scopeValue: row.scopeValue ?? null,
      scopeGroup: nullableString(row.scopeGroup) || 'default',
      scopeMode: nullableString(row.scopeMode) || 'intersect',
      status: normalizedStatus(row.status)
    }
  })

  const roleDefaultScopes = input.roleScopes.map((item) => {
    const row = recordValue(item)
    return {
      roleCode: row.roleCode,
      appCode: row.appCode,
      resourceCode: row.resourceCode,
      action: row.action,
      scopeType: row.scopeType,
      scopeValue: row.scopeValue,
      sourceManifestActionId: row.sourceManifestActionId ?? row.manifestActionId ?? null,
      sourceType: nullableString(row.sourceType) || 'custom',
      appRoleCode: nullableString(row.appRoleCode),
      status: normalizedStatus(row.status)
    }
  })

  const baselineGrants = input.baselinePermissions.map((item) => {
    const row = recordValue(item)
    return {
      grantId: baselineGrantId(row),
      appCode: row.appCode,
      resourceCode: row.resourceCode,
      action: row.action,
      scopeDimension: row.scopeType,
      scopePredicate: row.scopeValue,
      scopeValue: null,
      excludedSubjectCodes: stringArray(row.excludedSubjectCodes),
      sourceType: 'baseline',
      status: 'active'
    }
  })

  return {
    compatSchemaVersions: [...POLICY_BUNDLE_COMPAT_SCHEMA_VERSIONS],
    policyRevision: normalizedPolicyRevision(input.policyRevision),
    roleAssignments,
    rolePermissionGrants,
    assignmentScopes,
    roleDefaultScopes,
    baselineGrants,
    actionImplications: [
      ...DEFAULT_ACTION_IMPLICATIONS.map(item => ({ ...item, implies: [...item.implies] })),
      ...normalizeManifestActionImplications(input.actionImplications)
    ],
    conflictRules: input.conflictRules
  }
}

export function stripLegacyPolicyBundleAuthorizationFields<T extends Record<string, unknown>>(payload: T): T {
  delete payload.subjectRoles
  delete payload.subjectRoleScopes
  delete payload.rolePermissions
  delete payload.roleScopes
  delete payload.baselinePermissions

  return payload
}
