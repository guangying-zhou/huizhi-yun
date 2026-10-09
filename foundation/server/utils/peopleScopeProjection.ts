import { evaluateFoundationScopedAuthorization, type FoundationScopedAuthorizationInput } from './scopeEvaluator'

export type PeopleDirectoryNode = { deptCode: string, children?: PeopleDirectoryNode[] }
export type PeopleScopeProjection = { access: 'all' | 'self' | 'dept' | 'self_dept' | 'none', departmentCodes: string[] }
// Compile the unique evaluator's truth table, never reinterpret scope groups.
// Nonrepresentable owner AND department predicates fail closed rather than widen.
export function projectPeopleReadScope(input: Omit<FoundationScopedAuthorizationInput, 'object'>, actorUid: string, tree: PeopleDirectoryNode[]): PeopleScopeProjection | null {
  if (!actorUid) return null
  const predicates = input.grants.flatMap(g => [...g.defaultScopes || [], ...g.assignmentScopes || [], ...g.scopes || []])
  if (predicates.some(s => !(s.dimension === 'tenant' && s.predicate === 'global') && !(s.dimension === 'department' && ['self', 'tree'].includes(s.predicate)) && !(s.dimension === 'subject' && s.predicate === 'self'))) return null
  const ancestors = new Map<string, string[]>()
  let invalid = false
  const visit = (nodes: PeopleDirectoryNode[], parents: string[]) => {
    for (const node of nodes) {
      if (!node.deptCode || ancestors.has(node.deptCode) || ancestors.size >= 1000 || parents.length > 100) {
        invalid = true
        return
      }
      ancestors.set(node.deptCode, parents)
      visit(node.children || [], [...parents, node.deptCode])
    }
  }
  visit(tree, [])
  if (invalid) return null
  for (const p of predicates) if (p.dimension === 'department' && p.value && !ancestors.has(p.value)) ancestors.set(p.value, [])
  if (ancestors.size > 1000) return null
  const other = actorUid + '\u0000other'
  const unknown = '\u0000unregistered'
  const decision = (self: boolean, code: string) => evaluateFoundationScopedAuthorization({ ...input, object: { actorUid, ownerUid: self ? actorUid : other, departmentCode: code, departmentTree: ancestors.get(code) || [] } }).allowed
  const codes = [...ancestors.keys()].sort()
  const otherUnknown = decision(false, unknown)
  const selfUnknown = decision(true, unknown)
  const others = codes.filter(code => decision(false, code))
  const selves = codes.filter(code => decision(true, code))
  if (otherUnknown && selfUnknown && others.length === codes.length && selves.length === codes.length) return { access: 'all', departmentCodes: [] }
  if (!otherUnknown && selfUnknown && selves.length === codes.length) return { access: others.length ? 'self_dept' : 'self', departmentCodes: others }
  if (!otherUnknown && !selfUnknown && JSON.stringify(others) === JSON.stringify(selves)) return { access: others.length ? 'dept' : 'none', departmentCodes: others }
  return null
}
