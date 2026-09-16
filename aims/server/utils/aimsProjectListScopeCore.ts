interface ScopePredicate { dimension?: unknown, predicate?: unknown, value?: unknown }
interface ScopedGrant {
  permissions: Array<{ appCode: string, resourceCode: string, action: string }>
  defaultScopes?: ScopePredicate[]
  assignmentScopes?: ScopePredicate[]
  scopes?: ScopePredicate[]
}

export interface AimsProjectListScopeContext {
  deptCodes?: string[]
  managementDeptCodes?: string[]
}

interface ProjectListScope {
  global: boolean
  deptCodes: string[]
  projectCodes: string[]
  memberScope?: boolean
  ownerScope?: boolean
  memberProjectCodes?: string[]
  ownerProjectCodes?: string[]
}

const text = (value: unknown) => String(value || '').trim()
const tenantGlobal = (scope: ScopePredicate) => text(scope.dimension) === 'tenant' && text(scope.predicate) === 'global'

function departmentCodes(scopes: ScopePredicate[], context: AimsProjectListScopeContext) {
  const result = new Set<string>()
  for (const scope of scopes) {
    const predicate = text(scope.predicate)
    const value = text(scope.value)
    if (!['self', 'tree'].includes(predicate)) continue
    const values = value ? [value] : predicate === 'tree' ? context.managementDeptCodes || [] : context.deptCodes || []
    for (const code of values) if (text(code)) result.add(text(code))
  }
  return [...result]
}

function projectBranches(scopes: ScopePredicate[]) {
  const projectCodes = new Set<string>()
  const memberProjectCodes = new Set<string>()
  const ownerProjectCodes = new Set<string>()
  let memberScope = false
  let ownerScope = false
  for (const scope of scopes) {
    const predicate = text(scope.predicate)
    const value = text(scope.value)
    if (predicate === 'code' && value) projectCodes.add(value)
    if (predicate === 'member') {
      if (value) memberProjectCodes.add(value)
      else memberScope = true
    }
    if (predicate === 'owner') {
      if (value) ownerProjectCodes.add(value)
      else ownerScope = true
    }
  }
  return {
    projectCodes: [...projectCodes],
    memberScope,
    ownerScope,
    memberProjectCodes: [...memberProjectCodes],
    ownerProjectCodes: [...ownerProjectCodes]
  }
}

function intersectValuedRelationGroups(groups: ScopePredicate[][], predicate: 'member' | 'owner') {
  let allowedCodes: string[] | null = null
  for (const scopes of groups) {
    if (!scopes.length || scopes.some(scope => text(scope.predicate) !== predicate)) return undefined
    const codes = [...new Set(scopes.map(scope => text(scope.value)).filter(Boolean))]
    // An unvalued predicate is a wildcard relation constraint; valued siblings
    // in the same OR group also collapse to that wildcard.
    if (scopes.some(scope => !text(scope.value))) continue
    allowedCodes = allowedCodes === null ? codes : allowedCodes.filter(code => codes.includes(code))
  }
  return allowedCodes
}

function scopeFromGrant(grant: ScopedGrant, context: AimsProjectListScopeContext): ProjectListScope {
  const groups = [grant.defaultScopes || [], grant.assignmentScopes || [], grant.scopes || []]
    .map(scopes => scopes.filter(scope => !tenantGlobal(scope)))
    .filter(scopes => scopes.length)
  if (!groups.length) return { global: true, deptCodes: [], projectCodes: [] }

  let dimension = ''
  let allowedCodes: string[] | null = null
  let relation = { memberScope: false, ownerScope: false, memberProjectCodes: [] as string[], ownerProjectCodes: [] as string[] }
  const groupDimensions = groups.map(scopes => new Set(scopes.map(scope => text(scope.dimension)).filter(Boolean)))
  if (groupDimensions.some(dimensions => dimensions.size !== 1)) return { global: false, deptCodes: [], projectCodes: [] }
  const dimensions = new Set(groupDimensions.map(group => [...group][0]))
  if (dimensions.size !== 1) return { global: false, deptCodes: [], projectCodes: [] }
  dimension = [...dimensions][0] || ''

  if (dimension === 'project' && groups.length > 1) {
    const memberCodes = intersectValuedRelationGroups(groups, 'member')
    if (memberCodes !== undefined) {
      if (memberCodes === null) relation.memberScope = true
      else if (memberCodes.length) relation.memberProjectCodes = memberCodes
      else return { global: false, deptCodes: [], projectCodes: [] }
      return { global: false, deptCodes: [], projectCodes: [], ...relation }
    }
    const ownerCodes = intersectValuedRelationGroups(groups, 'owner')
    if (ownerCodes !== undefined) {
      if (ownerCodes === null) relation.ownerScope = true
      else if (ownerCodes.length) relation.ownerProjectCodes = ownerCodes
      else return { global: false, deptCodes: [], projectCodes: [] }
      return { global: false, deptCodes: [], projectCodes: [], ...relation }
    }
  }

  for (const scopes of groups) {
    let codes: string[] = []
    if (dimension === 'department') codes = departmentCodes(scopes, context)
    if (dimension === 'project') {
      const branches = projectBranches(scopes)
      const hasRelation = branches.memberScope || branches.ownerScope
        || branches.memberProjectCodes.length > 0 || branches.ownerProjectCodes.length > 0
      if (hasRelation) {
        if (groups.length !== 1) return { global: false, deptCodes: [], projectCodes: [] }
        relation = branches
      }
      codes = branches.projectCodes
    }
    if (!codes.length && !relation.memberScope && !relation.ownerScope
      && !relation.memberProjectCodes.length && !relation.ownerProjectCodes.length) {
      return { global: false, deptCodes: [], projectCodes: [] }
    }
    if (codes.length) allowedCodes = allowedCodes === null ? codes : allowedCodes.filter(code => codes.includes(code))
  }

  const codes = allowedCodes || []
  if (dimension === 'department') return { global: false, deptCodes: codes, projectCodes: [] }
  if (dimension === 'project') return { global: false, deptCodes: [], projectCodes: codes, ...relation }
  return { global: false, deptCodes: [], projectCodes: [] }
}

export function aimsProjectListAdminScopeQueryFromGrants(
  grants: ScopedGrant[],
  context: AimsProjectListScopeContext = {}
) {
  const deptCodes = new Set<string>()
  const projectCodes = new Set<string>()
  const memberProjectCodes = new Set<string>()
  const ownerProjectCodes = new Set<string>()
  let memberScope = false
  let ownerScope = false

  for (const grant of grants) {
    if (!grant.permissions.some(permission => permission.appCode === 'aims'
      && permission.resourceCode === 'projects' && permission.action === 'admin')) continue
    const scope = scopeFromGrant(grant, context)
    if (scope.global) return { current_user_is_project_admin: '1' }
    scope.deptCodes.forEach(code => deptCodes.add(code))
    scope.projectCodes.forEach(code => projectCodes.add(code))
    scope.memberProjectCodes?.forEach(code => memberProjectCodes.add(code))
    scope.ownerProjectCodes?.forEach(code => ownerProjectCodes.add(code))
    memberScope ||= scope.memberScope === true
    ownerScope ||= scope.ownerScope === true
  }

  const query: Record<string, string> = {}
  if (deptCodes.size) query.current_user_project_admin_dept_codes = [...deptCodes].join(',')
  if (memberScope) query.current_user_project_admin_member_scope = '1'
  if (ownerScope) query.current_user_project_admin_owner_scope = '1'
  if (projectCodes.size) query.current_user_project_admin_project_codes = [...projectCodes].join(',')
  if (memberProjectCodes.size) query.current_user_project_admin_member_project_codes = [...memberProjectCodes].join(',')
  if (ownerProjectCodes.size) query.current_user_project_admin_owner_project_codes = [...ownerProjectCodes].join(',')
  return query
}
