import type { Fact } from '../server/utils/environmentAppReleaseModel.ts'

/** Authorization-only overlay. Missing presentation/runtime facts remain historical, explicitly reported. */
export function overlayExportedGovernance(body: Fact, current: Fact, databaseTables: Fact) {
  const t = current.tables
  const roleById = new Map<number, Fact>(t.tenant_roles.map((r: Fact) => [r.id, r]))
  const roles = t.tenant_roles.filter((r: Fact) => r.status === 'active').map((r: Fact) => ({
    ...body.roles.find((old: Fact) => old.roleCode === r.role_code), roleCode: r.role_code, roleType: r.role_type, appCode: r.app_code,
    source: r.source, sourceRoleCode: r.source_role_code, sourceManifestId: r.source_manifest_id,
    isOverridden: r.is_overridden, isAssignable: r.is_assignable, status: r.status
  }))
  const activeRole = (r: Fact) => roleById.get(r.role_id)?.status === 'active'
  const legacyViewer = (r: Fact) => r.app_code === 'console' && ['console.viewer', 'tenant_console_view', 'tenant_console_viewer'].includes(String(roleById.get(r.role_id)?.role_code))
  const custom = (r: Fact) => ({ roleCode: roleById.get(r.role_id)!.role_code, appCode: r.app_code, resourceCode: r.resource_code, action: r.action, sourceManifestActionId: r.source_manifest_action_id, sourceType: 'custom', appRoleCode: null })
  const currentSubjects = new Map(t.tenant_subject_status.map((r: Fact) => [JSON.stringify([r.subject_type, r.subject_code]), r]))
  const subjects = body.subjects.map((old: Fact) => ({ ...old, status: (currentSubjects.get(JSON.stringify([old.subjectType, old.subjectCode])) as Fact | undefined)?.status || 'disabled' }))
  // Include new technical subjects; names/parent relationships were deliberately not exported.
  for (const row of t.tenant_subject_status) {
    if (!subjects.some((s: Fact) => s.subjectType === row.subject_type && s.subjectCode === row.subject_code)) subjects.push({ subjectType: row.subject_type, subjectCode: row.subject_code, status: row.status })
  }
  // Require mysql2 dateStrings:true exports; never infer a timezone for SQL DATETIME.
  const sqlDate = (v: unknown) => {
    if (typeof v === 'string' && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(v)) throw Error('Governance DATETIME must be an unchanged DB string')
    return v
  }
  const subjectRoles = t.effective_tenant_subject_roles.filter(activeRole).map((r: Fact) => ({ assignmentId: r.id, subjectType: r.subject_type, subjectCode: r.subject_code, roleCode: r.role_code, sourceType: r.source_type, sourceId: r.source_id, assignmentKind: r.assignment_kind, grantedAt: sqlDate(r.granted_at), startsAt: sqlDate(r.starts_at), expiresAt: sqlDate(r.expired_at), status: r.status }))
  if (t.effective_tenant_subject_role_scopes.length) throw Error('Nonempty assignment scopes require an explicit export adapter')
  const appRoleById = new Map<number, Fact>(databaseTables.platform_app_roles.map((r: Fact) => [r.id, r]))
  const appRoleScopes = databaseTables.platform_app_role_scopes.map((r: Fact) => ({ roleCode: appRoleById.get(r.app_role_id)?.role_code, appCode: r.app_code, resourceCode: r.resource_code, action: r.action, manifestActionId: r.manifest_action_id, scopeType: r.scope_type, scopeValue: r.scope_value, status: r.status, sourceType: r.source_type }))
  return { ...body, subjects, roles, subjectRoles, subjectRoleScopes: [], appRoleScopes,
    roleAppRoleMaps: t.tenant_role_app_role_maps.filter(activeRole).map((r: Fact) => ({ roleCode: roleById.get(r.role_id)!.role_code, appRoleCode: r.app_role_code, sourceSystemRoleCode: r.source_system_role_code, sortOrder: r.sort_order })),
    rolePermissions: t.tenant_role_permissions.filter((r: Fact) => activeRole(r) && !legacyViewer(r)).map(custom),
    roleScopes: t.tenant_role_scopes.filter((r: Fact) => activeRole(r) && r.status === 'active' && !legacyViewer(r)).map((r: Fact) => ({ ...custom(r), scopeType: r.scope_type, scopeValue: r.scope_value, status: r.status })),
    baselinePermissions: body.baselineGrants.map((g: Fact) => ({ ...g, scopeType: g.scopeDimension, scopeValue: g.scopePredicate }))
  }
}
