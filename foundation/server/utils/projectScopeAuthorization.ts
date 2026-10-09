import {
  evaluateFoundationScopedAuthorization,
  type FoundationObjectContext,
  type FoundationScopedAuthorizationInput,
  type FoundationScopePredicate
} from './scopeEvaluator'

// A truth table of business facts, not a second policy/grant evaluator.
// Relationship state: bit 0 = active member, bit 1 = project leader/owner, bit 2 = creator (subject:self), bit 3 = explicit participant relation.
export interface FoundationProjectScopeProjection {
  version: 1
  project_codes: string[]
  department_codes: string[]
  department_tree_roots: string[]
  // Project index × department index × ancestor mask. Index 0 means OTHER.
  masks: number[]
}

const MAX_CELLS = 4096
const MAX_CODES = 512
const MAX_CODE_LENGTH = 64

function utf8Compare(left: string, right: string) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function supported(scope: FoundationScopePredicate) {
  return (scope.dimension === 'tenant' && scope.predicate === 'global')
    || (scope.dimension === 'project' && ['code', 'member', 'owner'].includes(scope.predicate))
    || (scope.dimension === 'department' && ['self', 'tree'].includes(scope.predicate))
    || (scope.dimension === 'subject' && scope.predicate === 'self')
    || (scope.dimension === 'relation' && scope.predicate === 'participant')
}

function scopesOf(grant: FoundationScopedAuthorizationInput['grants'][number]) {
  return [...(grant.defaultScopes || []), ...(grant.assignmentScopes || []), ...(grant.scopes || [])]
}

export function compileFoundationProjectScope(
  input: Omit<FoundationScopedAuthorizationInput, 'object'>,
  actorUid: string
): FoundationProjectScopeProjection | null {
  if (!actorUid.trim()) return null
  const grants = input.grants.filter(grant => evaluateFoundationScopedAuthorization({
    ...input, grants: [{ ...grant, scopes: [], defaultScopes: [], assignmentScopes: [] }]
  }).allowed)
  const projects = new Set<string>()
  const departments = new Set<string>()
  const roots = new Set<string>()
  for (const grant of grants) {
    for (const scope of scopesOf(grant)) {
      // Unsupported facts or an overlarge domain fail the whole compilation.
      // Never silently drop a scope from a grant.
      if (!supported(scope)) return null
      const value = String(scope.value || '').trim()
      if ([...value].length > MAX_CODE_LENGTH || [...value].some(char => char.codePointAt(0)! < 32 || (char.codePointAt(0)! >= 127 && char.codePointAt(0)! <= 159))) return null
      if (scope.dimension === 'project' && value) projects.add(value)
      if (scope.dimension === 'department' && value) {
        departments.add(value)
        if (scope.predicate === 'tree') roots.add(value)
      }
    }
  }
  if (projects.size > MAX_CODES || departments.size > MAX_CODES || roots.size > 10) return null
  const project_codes = [...projects].sort(utf8Compare)
  const department_codes = [...departments].sort(utf8Compare)
  const department_tree_roots = [...roots].sort(utf8Compare)
  const treeCount = 2 ** roots.size
  const cells = (projects.size + 1) * (departments.size + 1) * treeCount
  if (cells > MAX_CELLS) return null
  // Control-character sentinels cannot collide with a supported scope value.
  const projectValues = ['\u0000other-project', ...project_codes]
  const departmentValues = ['\u0000other-department', ...department_codes]
  const masks: number[] = []
  for (const projectCode of projectValues) {
    for (const departmentCode of departmentValues) {
      for (let tree = 0; tree < treeCount; tree++) {
        let mask = 0
        for (let state = 0; state < 16; state++) {
          const object: FoundationObjectContext = {
            actorUid, projectCode, departmentCode,
            departmentTree: department_tree_roots.filter((_, index) => (tree & (1 << index)) !== 0),
            projectMemberUids: state & 1 ? [actorUid] : [],
            projectOwnerUid: state & 2 ? actorUid : null,
            ownerUid: state & 4 ? actorUid : null,
            matchedRelations: state & 8 ? ['participant'] : []
          }
          if (evaluateFoundationScopedAuthorization({ ...input, grants, object }).allowed) mask |= 1 << state
        }
        masks.push(mask)
      }
    }
  }
  return { version: 1, project_codes, department_codes, department_tree_roots, masks }
}

// Reference selector for contract tests. Callers must verify the signed permit
// and derive these facts from the authoritative project, not request input.
export function foundationProjectProjectionAllows(
  projection: FoundationProjectScopeProjection,
  facts: { projectCode: string, departmentCode: string, departmentTree: string[], member: boolean, owner: boolean, creator: boolean, participant: boolean }
) {
  const project = projection.project_codes.indexOf(facts.projectCode.trim()) + 1
  const department = projection.department_codes.indexOf(facts.departmentCode.trim()) + 1
  let tree = 0
  projection.department_tree_roots.forEach((root, index) => {
    if (facts.departmentTree.some(code => code.trim() === root)) tree |= 1 << index
  })
  const index = (project * (projection.department_codes.length + 1) + department)
    * (2 ** projection.department_tree_roots.length) + tree
  const state = (facts.member ? 1 : 0) | (facts.owner ? 2 : 0) | (facts.creator ? 4 : 0) | (facts.participant ? 8 : 0)
  return ((projection.masks[index] ?? 0) & (1 << state)) !== 0
}

// Conservative deadline across active source records. A short-lived permit may
// expire earlier because of an unrelated grant, but never after a source expires.
// Console computes this from its verified payload, not request-supplied facts.
export function projectScopeSourceDeadline(payload: Record<string, unknown>, now = Date.now()) {
  let deadline = now + 14_000
  for (const value of Object.values(payload)) {
    if (!Array.isArray(value)) continue
    for (const record of value) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue
      if (String(record.status || '').trim() && String(record.status).trim() !== 'active') continue
      const raw = [record.expiresAt, record.expires_at, record.expiredAt, record.expired_at].find(value => value != null && String(value).trim())
      if (raw == null || raw === '') continue
      const expires = Date.parse(String(raw))
      if (!Number.isFinite(expires)) return now
      if (expires > now) deadline = Math.min(deadline, expires)
    }
  }
  return deadline
}
