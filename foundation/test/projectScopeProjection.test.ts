import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileFoundationProjectScope, foundationProjectProjectionAllows } from '../server/utils/projectScopeAuthorization.ts'
import { buildScopedAuthorizationGrantsFromPolicyBundle } from '../server/utils/applicationAuthorization.ts'
import { evaluateFoundationScopedAuthorization, type FoundationScopedAuthorizationGrant } from '../server/utils/scopeEvaluator.ts'

const required = { appCode: 'aims', resourceCode: 'projects', action: 'view' }
const grant = (extra: Partial<FoundationScopedAuthorizationGrant> = {}): FoundationScopedAuthorizationGrant => ({
  grantId: 'g', permissions: [required], ...extra
})
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/project-scope-projection.json', import.meta.url), 'utf8'))
for (const fixture of fixtures) {
  test(`shared TS/Go project projection: ${fixture.name}`, () => {
    const projection = compileFoundationProjectScope({ required, grants: [grant({ scopes: fixture.scopes })] }, 'actor')
    assert.deepEqual(projection, fixture.projection)
    for (const row of fixture.cases) assert.equal(foundationProjectProjectionAllows(projection!, row.facts), row.allowed)
  })
}

test('project creation cannot bootstrap owner/member/participant/self relations from its proposed leader', () => {
  const create = { appCode: 'aims', resourceCode: 'projects', action: 'create' }
  const empty = { projectCode: 'NEW-1', departmentCode: 'D-A', departmentTree: [], member: false, owner: false, creator: false, participant: false }
  for (const scope of [
    { dimension: 'project', predicate: 'member' },
    { dimension: 'project', predicate: 'owner' },
    { dimension: 'relation', predicate: 'participant' },
    { dimension: 'subject', predicate: 'self' }
  ]) {
    const projection = compileFoundationProjectScope({ required: create, grants: [grant({ permissions: [create], scopes: [scope] })] }, 'actor')!
    assert.equal(foundationProjectProjectionAllows(projection, empty), false)
  }
  const dept = compileFoundationProjectScope({ required: create, grants: [grant({ permissions: [create], scopes: [{ dimension: 'department', predicate: 'self', value: 'D-A' }] })] }, 'actor')!
  assert.equal(foundationProjectProjectionAllows(dept, empty), true)
  assert.equal(foundationProjectProjectionAllows(dept, { ...empty, departmentCode: 'D-B' }), false)
  assert.equal(foundationProjectProjectionAllows(dept, { ...empty, departmentCode: '' }), false)
})

test('project projection preserves grant OR, scope set AND, dimension OR and independent owner/member states', () => {
  const grants = [
    grant({ grantId: 'a', defaultScopes: [{ dimension: 'project', predicate: 'member' }], assignmentScopes: [{ dimension: 'project', predicate: 'code', value: '263' }], scopes: [{ dimension: 'department', predicate: 'tree', value: 'D' }] }),
    grant({ grantId: 'b', scopes: [{ dimension: 'project', predicate: 'owner', value: '257' }, { dimension: 'project', predicate: 'code', value: '264' }] })
  ]
  const projection = compileFoundationProjectScope({ required, grants }, 'actor')!
  for (const projectCode of ['263', '257', '264', 'other']) {
    for (const departmentCode of ['D', 'child', 'other']) {
      for (const departmentTree of [[], ['D']]) {
        for (let state = 0; state < 16; state++) {
          const facts = { projectCode, departmentCode, departmentTree, member: !!(state & 1), owner: !!(state & 2), creator: !!(state & 4), participant: !!(state & 8) }
          const expected = evaluateFoundationScopedAuthorization({ required, grants, object: {
            actorUid: 'actor', projectCode, departmentCode, departmentTree,
            projectMemberUids: facts.member ? ['actor'] : [],
            projectOwnerUid: facts.owner ? 'actor' : null, ownerUid: facts.creator ? 'actor' : null, matchedRelations: facts.participant ? ['participant'] : []
          } }).allowed
          assert.equal(foundationProjectProjectionAllows(projection, facts), expected, JSON.stringify(facts))
        }
      }
    }
  }
  const isolated = compileFoundationProjectScope({ required, grants: [
    grant({ defaultScopes: [{ dimension: 'project', predicate: 'code', value: '263' }], assignmentScopes: [{ dimension: 'project', predicate: 'code', value: '257' }] })
  ] }, 'actor')!
  assert.ok(isolated.masks.every(mask => mask === 0))
})

test('unknown predicates, missing actor and excessive domains fail closed without truncation', () => {
  for (const scope of [
    { dimension: 'project', predicate: 'manager' },
    { dimension: 'environment', predicate: 'test' },
    { dimension: 'relation', predicate: 'project_member' },
    { dimension: 'project', predicate: 'code', value: 'x'.repeat(65) }
  ]) assert.equal(compileFoundationProjectScope({ required, grants: [grant({ scopes: [scope] })] }, 'actor'), null)
  assert.equal(compileFoundationProjectScope({ required, grants: [grant()] }, ''), null)
  assert.equal(compileFoundationProjectScope({ required, grants: [grant({ scopes: Array.from({ length: 513 }, (_, index) => ({ dimension: 'project', predicate: 'code', value: String(index) })) })] }, 'actor'), null)
  assert.equal(compileFoundationProjectScope({ required, grants: [grant({ scopes: Array.from({ length: 10 }, (_, index) => ({ dimension: 'department', predicate: 'tree', value: String(index) })) })] }, 'actor'), null)
})

test('unrelated actions do not poison compilation; admin implies view but never sensitive export', () => {
  const grants = [grant({ permissions: [{ ...required, action: 'admin' }] }), grant({ permissions: [{ ...required, resourceCode: 'other' }], scopes: [{ dimension: 'unsupported', predicate: 'unknown' }] })]
  assert.deepEqual(compileFoundationProjectScope({ required, grants }, 'actor')?.masks, [65535])
  assert.deepEqual(compileFoundationProjectScope({ required: { ...required, action: 'export' }, grants }, 'actor')?.masks, [0])
  assert.deepEqual(compileFoundationProjectScope({ required, grants: [] }, 'actor')?.masks, [0])
})

test('filtered custom role grants retain merge, simulation, expiration and revocation before compilation', () => {
  const payload = {
    subjects: [{ subjectType: 'user', subjectCode: 'subject-actor', externalRef: 'actor', status: 'active' }],
    roles: ['reader263', 'reader257'].map(roleCode => ({ roleCode, appCode: null, isAssignable: true, status: 'active', source: 'custom' })),
    roleAssignments: ['reader263', 'reader257'].map((roleCode, index) => ({ assignmentId: index + 1, subjectType: 'user', subjectCode: 'subject-actor', roleCode, status: 'active', expiresAt: null as string | null })),
    rolePermissionGrants: ['reader263', 'reader257'].map(roleCode => ({ roleCode, ...required })),
    assignmentScopes: ['263', '257'].map((scopeValue, index) => ({ assignmentId: index + 1, ...required, scopeDimension: 'project', scopePredicate: 'code', scopeValue, scopeMode: 'intersect', status: 'active' }))
  }
  const compile = (simulation = false) => {
    const built = buildScopedAuthorizationGrantsFromPolicyBundle({ payload, uid: 'actor', requestedRoleCode: 'reader263', authorizationMode: simulation ? 'role_simulation' : 'merged', allowRoleSimulation: simulation })
    return compileFoundationProjectScope({ grants: built.grants, required }, 'actor')!
  }
  const facts = { projectCode: '257', departmentCode: '', departmentTree: [], member: false, owner: false, creator: false, participant: false }
  assert.equal(foundationProjectProjectionAllows(compile(), facts), true)
  assert.equal(foundationProjectProjectionAllows(compile(true), facts), false)
  payload.roleAssignments[1]!.status = 'expired'
  assert.equal(foundationProjectProjectionAllows(compile(), facts), false)
  payload.roleAssignments[1]!.status = 'revoked'
  assert.equal(foundationProjectProjectionAllows(compile(), facts), false)
  payload.roleAssignments[1]!.status = 'active'
  payload.roleAssignments[1]!.expiresAt = '2000-01-01T00:00:00Z'
  assert.equal(foundationProjectProjectionAllows(compile(), facts), false)
})

test('participant baseline remains an explicit fact, never inferred from company visibility', () => {
  const projection = compileFoundationProjectScope({ required, grants: [grant({ scopes: [{ dimension: 'relation', predicate: 'participant' }] })] }, 'actor')!
  assert.deepEqual(projection.masks, [65280])
  const facts = { projectCode: '263', departmentCode: '', departmentTree: [], member: true, owner: true, creator: true, participant: false }
  assert.equal(foundationProjectProjectionAllows(projection, facts), false)
  assert.equal(foundationProjectProjectionAllows(projection, { ...facts, participant: true }), true)
})

test('project source deadline clips short permits at source expiration', async () => {
  const { projectScopeSourceDeadline } = await import('../server/utils/projectScopeAuthorization.ts')
  const now = Date.parse('2026-09-27T00:00:00Z')
  assert.equal(projectScopeSourceDeadline({}, now), now + 14000)
  assert.equal(projectScopeSourceDeadline({ roleAssignments: [{ status: 'active', expiresAt: new Date(now + 2000).toISOString() }] }, now), now + 2000)
  assert.equal(projectScopeSourceDeadline({ roleAssignments: [{ status: 'revoked', expiresAt: new Date(now + 2000).toISOString() }] }, now), now + 14000)
})
