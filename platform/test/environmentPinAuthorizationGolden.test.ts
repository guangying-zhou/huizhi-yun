import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { projectEnvironmentReleaseFacts, type Fact, type EnvironmentAppSelection } from '../server/utils/environmentAppReleaseModel.ts'
import { buildPolicyBundleV2CompatFields } from '../server/utils/policyBundleV2.ts'

// Exercise the owning Foundation grant compiler/evaluator, not a copied permission algorithm.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (!existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
  }
  return next(specifier, context)
} })
const { evaluatePolicyBundleScopedAuthorization: evaluate } = await import('../../foundation/server/utils/applicationAuthorization.ts')
hooks.deregister()

const catalog = ['view', 'edit', 'admin', 'approve'].map((action, index) => ({ id: index + 1, appCode: 'finance', resourceCode: 'payments', action }))
const selection: EnvironmentAppSelection = { revision: 1, sourceBundleId: 1, sourceBundleHash: 'fixture', baseline: null, pins: [{ appCode: 'finance', releaseId: 1 }], releases: [{ appCode: 'finance', releaseId: 1, manifestId: 1, manifestHash: 'fixture', releaseVersion: 'v1', sourceTag: 'finance/v1', resources: [], actions: catalog, manifest: { recommendedRoles: [{ code: 'finance:editor', name: 'Editor', suggestedPermissions: ['finance:payments:admin'] }, { code: 'finance:approver', name: 'Approver', suggestedPermissions: ['finance:payments:approve'] }] } }] }
const roles = ['editor', 'reviewer', 'scope-only', 'custom'].map(roleCode => ({ roleCode, roleType: 'business', appCode: null, status: 'active', isAssignable: 1, source: roleCode === 'custom' ? 'custom' : 'system', sourceRoleCode: 'template', isOverridden: 0 }))
const assignments = roles.map((r, i) => ({ assignmentId: i + 1, subjectType: 'user', subjectCode: 'fixture-user', roleCode: r.roleCode, status: 'active' }))
function candidate(overrides: Fact = {}) {
  const facts: Fact = { roles, roleAppRoleMaps: [{ roleCode: 'editor', appRoleCode: 'finance:editor' }, { roleCode: 'reviewer', appRoleCode: 'finance:approver' }], systemAppRoleMaps: [], appRoleScopes: [], applications: [], rolePermissions: [], roleScopes: [
    { roleCode: 'editor', appCode: 'finance', resourceCode: 'payments', action: 'admin', sourceType: 'custom', scopeType: 'project', scopeValue: 'code:PROJECT-A', status: 'active' },
    { roleCode: 'reviewer', appCode: 'finance', resourceCode: 'payments', action: 'approve', sourceType: 'custom', scopeType: 'project', scopeValue: 'code:PROJECT-B', status: 'active' },
    { roleCode: 'scope-only', appCode: 'finance', resourceCode: 'payments', action: 'approve', sourceType: 'custom', scopeType: 'tenant', scopeValue: 'global', status: 'active' }
  ], subjectRoleScopes: [], baselinePermissions: [], ...overrides }
  const p = projectEnvironmentReleaseFacts(facts, selection)
  return { ...p, subjects: [{ subjectType: 'user', subjectCode: 'fixture-user', status: 'active' }], roles: facts.roles, ...buildPolicyBundleV2CompatFields({ tenantCode: 'T', environment: 'prod', subjectRoles: overrides.assignments || assignments, subjectRoleScopes: p.subjectRoleScopes, rolePermissions: p.rolePermissions, roleScopes: p.roleScopes, baselinePermissions: [], conflictRules: [], actionImplications: [], policyRevision: 1 }) }
}
const decision = (payload: Fact, action: string, projectCode: string, extra: Fact = {}) => evaluate({ payload, uid: 'fixture-user', required: { appCode: 'finance', resourceCode: 'payments', action }, object: { actorUid: 'fixture-user', projectCode }, authorizationMode: 'merged', ...extra }).allowed

test('golden: combined roles, scoped contexts, explicit sensitive action and simulation isolation', () => {
  const p = candidate()
  assert.equal(decision(p, 'view', 'PROJECT-A'), true)
  assert.equal(decision(p, 'edit', 'PROJECT-A'), true)
  assert.equal(decision(p, 'approve', 'PROJECT-B'), true)
  assert.equal(decision(p, 'approve', 'PROJECT-A'), false, 'admin never implies approve and scope-only role cannot lend its scope')
  assert.equal(decision(p, 'approve', 'PROJECT-C'), false)
  assert.equal(decision(p, 'approve', 'PROJECT-B', { authorizationMode: 'role_simulation', allowRoleSimulation: true, requestedRoleCode: 'editor' }), false)
})
test('golden: current mapping revocation, disabled role, expired assignment and custom roles stay authoritative', () => {
  assert.equal(decision(candidate({ roleAppRoleMaps: [] }), 'view', 'PROJECT-A'), false)
  assert.equal(decision(candidate({ roles: roles.map(r => r.roleCode === 'reviewer' ? { ...r, status: 'disabled' } : r) }), 'approve', 'PROJECT-B'), false)
  assert.equal(decision(candidate({ assignments: assignments.map(a => a.roleCode === 'reviewer' ? { ...a, expiresAt: '2000-01-01T00:00:00Z' } : a) }), 'approve', 'PROJECT-B'), false)
  const custom = candidate({ rolePermissions: [{ roleCode: 'custom', appCode: 'finance', resourceCode: 'payments', action: 'approve', sourceType: 'custom' }], roleScopes: [{ roleCode: 'custom', appCode: 'finance', resourceCode: 'payments', action: 'approve', sourceType: 'custom', scopeType: 'project', scopeValue: 'code:PROJECT-C', status: 'active' }] })
  assert.equal(decision(custom, 'approve', 'PROJECT-C'), true)
})
