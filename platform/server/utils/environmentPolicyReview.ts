import { diffEnvironmentPolicy, pinHash, type Fact } from './environmentAppReleaseModel.ts'
import { rolePermissionGrantId } from './policyBundleV2.ts'

const records = (v: unknown): Fact[] => Array.isArray(v) ? v : []
const actionKey = (r: Fact) => JSON.stringify([r.appCode, r.resourceCode, r.action])
const identifierFields: Record<string, string[]> = {
  rolePermissionGrants: ['sourceManifestActionId', 'grantId'],
  roleDefaultScopes: ['sourceManifestActionId'],
  appRolePermissions: ['manifestActionId'],
  appRoleScopes: ['manifestActionId'],
  manifestResources: ['manifestId'],
  manifestActions: ['manifestId']
}
const governanceFields = new Set(['subjects', 'subjectMemberships', 'roles', 'roleAssignments', 'roleHolderRevisions', 'systemRoles', 'templateRoles', 'templateBindings', 'templateOverrides', 'permissionTemplates', 'capabilities', 'conflictRules'])

/** Diagnostic only. Never normalizes the signed payload, full diff or review hash. */
export function reviewEnvironmentPolicy(before: Fact, after: Fact) {
  const diff = diffEnvironmentPolicy(before, after)
  const oldActions = new Set(records(before.manifestActions).map(actionKey))
  const newActions = new Set(records(after.manifestActions).map(actionKey))
  const commonAction = (r: Fact) => oldActions.has(actionKey(r)) && newActions.has(actionKey(r))
  const commonResource = (r: Fact) => [before, after].every(p => records(p.manifestResources).some(a => a.appCode === r.appCode && a.resourceCode === r.resourceCode))
  const unchangedAppRoleDefinition = (field: string, r: Fact) => [before, after].every(p => records(p[field === 'roleDefaultScopes' ? 'appRoleScopes' : 'appRolePermissions']).some(a => a.roleCode === r.appRoleCode && actionKey(a) === actionKey(r) && (field !== 'roleDefaultScopes' || (a.scopeType === r.scopeType && a.scopeValue === r.scopeValue && a.status === r.status))))
  const oldRoles = new Set(records(before.appRoles).map(r => r.roleCode))
  const newRoles = new Set(records(after.appRoles).map(r => r.roleCode))
  const origin = (field: string, row?: Fact): 'governance' | 'release' => {
    if (governanceFields.has(field)) return 'governance'
    if (row && field === 'roleAppRoleMaps' && oldRoles.has(row.appRoleCode) && newRoles.has(row.appRoleCode)) return 'governance'
    if (row && commonAction(row) && (['assignmentScopes', 'baselineGrants'].includes(field) || (['rolePermissionGrants', 'roleDefaultScopes'].includes(field) && (row.sourceType === 'custom' || (row.sourceType === 'app_role' && unchangedAppRoleDefinition(field, row)))))) return 'governance'
    return 'release'
  }
  const equivalent: Array<{ field: string, before: Fact, after: Fact, reason: string, behaviorChanges: number }> = []
  const real: Array<Fact & { field: string, origin: 'governance' | 'release' }> = []
  const provenance: Fact[] = []
  for (const change of diff) {
    if (change.field === 'appReleaseSelection') {
      provenance.push(change)
      continue
    }
    if (!Array.isArray(change.removed) || !Array.isArray(change.added)) {
      real.push({ ...change, field: change.field, origin: origin(change.field) })
      continue
    }
    const ignored = identifierFields[change.field]
    const strip = (row: Fact) => Object.fromEntries(Object.entries(row).filter(([k]) => !ignored?.includes(k)))
    const idValid = (row: Fact) => {
      const id = row[ignored![0]!]
      return ((Number.isSafeInteger(id) && id > 0) || (change.field === 'roleDefaultScopes' && id === null)) && (change.field === 'manifestResources' ? commonResource(row) : commonAction(row))
        && (change.field !== 'rolePermissionGrants' || row.grantId === rolePermissionGrantId(row))
    }
    const consumed = new Set<number>()
    const removed: Fact[] = []
    for (const row of change.removed) {
      const index = ignored && idValid(row) ? change.added.findIndex((next: Fact, i: number) => !consumed.has(i) && idValid(next) && pinHash(strip(row)) === pinHash(strip(next))) : -1
      if (index < 0) removed.push(row)
      else {
        consumed.add(index)
        equivalent.push({ field: change.field, before: row, after: change.added[index], reason: 'catalog-or-source-id-only', behaviorChanges: 0 })
      }
    }
    const added = change.added.filter((_: Fact, i: number) => !consumed.has(i))
    for (const group of ['governance', 'release'] as const) {
      const a = added.filter((r: Fact) => origin(change.field, r) === group)
      const r = removed.filter((r: Fact) => origin(change.field, r) === group)
      if (a.length || r.length) real.push({ field: change.field, origin: group, added: a, removed: r })
    }
  }
  return { version: 1, equivalent, real, provenance }
}
