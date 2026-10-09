import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseAppPins, pinEnvironment, pinHash, projectEnvironmentReleaseFacts, diffEnvironmentPolicy, type Fact, type ResolvedAppRelease, type EnvironmentAppSelection } from '../server/utils/environmentAppReleaseModel.ts'
import { buildPolicyBundleV2CompatFields } from '../server/utils/policyBundleV2.ts'
import { resolveOpsPermission } from '../server/utils/platformOpsPermissionRoutes.ts'

export function release(appCode: string, id: number, extra = false): ResolvedAppRelease {
  const resources = ['overview', ...(extra ? [appCode === 'console' ? 'announcements' : 'future-apf'] : [])]
  const actions = resources.flatMap((resourceCode, i) => ['view', 'admin'].map((action, j) => ({ id: id * 100 + i * 10 + j, manifestId: id, appCode, resourceCode, action, actionCode: `${appCode}:${resourceCode}:${action}`, status: 'active' })))
  return { appCode, releaseId: id, releaseVersion: `v${id}`, sourceTag: `${appCode}/v${id}`, manifestId: id, manifestHash: `hash${id}`,
    resources: resources.map(resourceCode => ({ appCode, manifestId: id, resourceCode, status: 'active' })), actions,
    manifest: { recommendedRoles: [{ code: `${appCode}:admin`, name: '管理员', suggestedPermissions: actions.map(a => a.actionCode) }] } }
}
function selection(releases: ResolvedAppRelease[], baseline: Fact | null = null): EnvironmentAppSelection {
  return { revision: 1, sourceBundleId: 40, sourceBundleHash: 'baseline', baseline, pins: releases.map(r => ({ appCode: r.appCode, releaseId: r.releaseId })), releases }
}
function sourceFacts(releases: ResolvedAppRelease[]): Fact {
  const base: Fact = { roles: [{ roleCode: 'sales', source: 'custom' }], applications: releases.map(r => ({ appCode: r.appCode })), subjectRoles: [{ subjectCode: 'alice', roleCode: 'sales' }], subjectRoleScopes: [], baselinePermissions: [], systemAppRoleMaps: [], rolePermissions: [], roleScopes: [], roleAppRoleMaps: releases.map(r => ({ roleCode: 'sales', appRoleCode: `${r.appCode}:admin` })), appRoleScopes: releases.flatMap(r => r.actions.map(a => ({ roleCode: `${r.appCode}:admin`, appCode: r.appCode, resourceCode: a.resourceCode, action: a.action, manifestActionId: a.id, scopeType: 'tenant', scopeValue: 'global', status: 'active', sourceType: 'manual' }))) }
  const projected = projectEnvironmentReleaseFacts(base, selection(releases))
  projected.appRoleScopes = projected.appRoleScopes.map((scope: Fact) => ({ ...scope, sourceType: 'manual' }))
  return projected
}
test('prod historical pins isolate APF from global latest; only Console announcement delta enters authorization compiler', () => {
  const old = ['altoc', 'finance', 'people', 'console'].map((a, i) => release(a, i + 1))
  const baseline = projectEnvironmentReleaseFacts(sourceFacts(old), selection(old))
  const current = sourceFacts(old.map(r => release(r.appCode, r.releaseId + 10, true)))
  const pinned = projectEnvironmentReleaseFacts({ ...current, roleAppRoleMaps: baseline.roleAppRoleMaps }, selection(old, baseline))
  for (const field of ['manifestResources', 'manifestActions', 'appRoles', 'appRolePermissions', 'appRoleScopes', 'rolePermissions', 'roleScopes']) assert.deepEqual(pinned[field], baseline[field], field)
  const upgraded = projectEnvironmentReleaseFacts(current, selection([...old.slice(0, 3), release('console', 14, true)], baseline))
  const diff = diffEnvironmentPolicy(baseline, upgraded)
  for (const d of diff) for (const row of [...(d.added || []), ...(d.removed || [])]) assert.ok(!['altoc', 'finance', 'people'].includes(row.appCode), `${d.field} leaked APF`)
  assert.ok(upgraded.manifestActions.some((a: Fact) => a.appCode === 'console' && a.resourceCode === 'announcements'))
  const compiled = buildPolicyBundleV2CompatFields({ tenantCode: 'T', environment: 'prod', subjectRoles: current.subjectRoles, subjectRoleScopes: [], rolePermissions: upgraded.rolePermissions, roleScopes: upgraded.roleScopes, baselinePermissions: [], conflictRules: [], actionImplications: [], policyRevision: 40 })
  assert.ok(!JSON.stringify(compiled).includes('future-apf'))
  assert.ok(JSON.stringify(compiled).includes('announcements'))
  assert.ok(JSON.stringify(projectEnvironmentReleaseFacts(current, selection(old.map(r => release(r.appCode, r.releaseId + 10, true))))).includes('future-apf'), 'independent test/latest selection remains current')
})
test('pin does not restore current user assignments or custom grants; no scope invented for new actions', () => {
  const old = [release('console', 1)]
  const baseline = sourceFacts(old)
  const current = { ...sourceFacts([release('console', 2, true)]), subjectRoles: [], rolePermissions: [], roleAppRoleMaps: [], appRoleScopes: [] }
  const result = projectEnvironmentReleaseFacts(current, selection([release('console', 2, true)], baseline))
  assert.deepEqual(result.subjectRoles, [])
  assert.deepEqual(result.rolePermissions, [])
  assert.ok(!result.appRoleScopes.some((r: Fact) => r.resourceCode === 'announcements'))
})
test('explicit manifest defaults are versioned, admin does not synthesize sensitive actions', () => {
  const r = release('console', 2, true)
  r.manifest.supportedScopes = ['subject:self']
  r.manifest.recommendedRoles[0].defaultScopes = ['subject:self']
  const result = projectEnvironmentReleaseFacts({ ...sourceFacts([r]), appRoleScopes: [] }, selection([r]))
  assert.ok(result.appRoleScopes.every((r: Fact) => r.scopeValue === 'self'))
  assert.ok(!result.appRolePermissions.some((r: Fact) => r.action === 'submit'))
})
test('selection rejects invalid environment, duplicates, coerced IDs and unknown keys', () => {
  for (const v of ['', undefined, 'PROD', 'production'])assert.throws(() => pinEnvironment(v), { statusCode: 400 })
  for (const v of [[], [{ appCode: 'console', releaseId: '1' }], [{ appCode: 'console', releaseId: 1, mode: 'latest' }], [{ appCode: 'console', releaseId: 1 }, { appCode: 'console', releaseId: null }]])assert.throws(() => parseAppPins(v), { statusCode: 400 })
  assert.deepEqual(parseAppPins([{ appCode: 'console', releaseId: null }]), [{ appCode: 'console', releaseId: null }])
})
test('preview diff includes permission removals/scopes/non-target facts but ignores sorting and generated clock', () => {
  assert.deepEqual(diffEnvironmentPolicy({ a: [2, 1], generatedAt: 'a' }, { a: [1, 2], generatedAt: 'b' }), [])
  assert.equal(diffEnvironmentPolicy({ scopeGrants: [{ scopeValue: 'self' }] }, { scopeGrants: [{ scopeValue: 'global' }] })[0]?.field, 'scopeGrants')
  assert.notEqual(pinHash({ pins: [1] }), pinHash({ pins: [2] }))
  assert.equal(diffEnvironmentPolicy({ role: { policyRevision: 1 } }, { role: { policyRevision: 2 } }).length, 1, 'nested authority revisions remain visible')
})
test('preview is read-only; environment pin writes and signing require explicit deploy permission', () => {
  const base = '/api/platform/ops/tenants/T/app-releases'
  assert.deepEqual(resolveOpsPermission(base + '/preview', 'POST'), { resourceCode: 'ops.deployments', requiredAction: 'view' })
  assert.deepEqual(resolveOpsPermission(base, 'PUT'), { resourceCode: 'ops.deployments', requiredAction: 'deploy' })
  assert.deepEqual(resolveOpsPermission(base + '/', 'PUT'), { resourceCode: 'ops.deployments', requiredAction: 'deploy' })
  for (const [file, write] of [['index.get.ts', false], ['preview.post.ts', false], ['index.put.ts', true]] as const) {
    const handler = readFileSync(new URL(`../server/api/platform/ops/tenants/[tenantCode]/app-releases/${file}`, import.meta.url), 'utf8')
    assert.ok(handler.includes(`await requireEnvironmentAppReleaseAccess(event${write ? ', true' : ''})`))
  }
  const source = readFileSync(new URL('../server/utils/environmentAppReleasePreview.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /generatePolicyBundle|withTransaction|\.execute\(|\bsign\(/)
  const builder = readFileSync(new URL('../server/utils/policyBundle.ts', import.meta.url), 'utf8')
  assert.match(builder, /if \(!selection\) await syncInheritedSystemRoles/)
  assert.match(builder, /await assertSelectionUnchanged\(tx/)
})

test('manual scope revocation overrides manifest defaults and latest defaults never leak', () => {
  const r = release('console', 1)
  r.manifest.supportedScopes = ['tenant:global']
  r.manifest.recommendedRoles[0].defaultScopes = ['tenant:global']
  const source = sourceFacts([r])
  source.appRoleScopes = r.actions.map(a => ({ roleCode: 'console:admin', appCode: 'console', resourceCode: a.resourceCode, action: a.action, scopeType: 'tenant', scopeValue: 'global', status: 'inactive', sourceType: 'manual' }))
  assert.deepEqual(projectEnvironmentReleaseFacts(source, selection([r])).appRoleScopes, [])
  delete r.manifest.recommendedRoles[0].defaultScopes
  source.appRoleScopes = source.appRoleScopes.map((row: Fact) => ({ ...row, status: 'active', sourceType: 'manifest_default' }))
  assert.deepEqual(projectEnvironmentReleaseFacts(source, selection([r])).appRoleScopes, [])
})

test('actual prod39 APF technical slice survives newer manifests, including explicit People admin approval permissions', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/prod39-apf-catalog.json', import.meta.url), 'utf8'))
  const old = fixture.sections as Fact
  // The slice proves historical permission facts, not the missing Platform release-ID mapping.
  // Reconstruct only the parser input in this fixture; production always loads stored manifest_json.
  const historical: ResolvedAppRelease[] = ['altoc', 'finance', 'people'].map((appCode, index) => {
    const resources = old.manifestResources.filter((r: Fact) => r.appCode === appCode)
    const actions = old.manifestActions.filter((a: Fact) => a.appCode === appCode).map((a: Fact) => ({ ...a, id: old.appRolePermissions.find((p: Fact) => p.appCode === a.appCode && p.resourceCode === a.resourceCode && p.action === a.action)?.manifestActionId || 0 }))
    return { appCode, releaseId: index + 1, releaseVersion: 'fixture-only', sourceTag: 'fixture-not-release-proof', manifestId: resources[0].manifestId, manifestHash: 'fixture', resources, actions,
      manifest: { recommendedRoles: old.appRoles.filter((r: Fact) => r.appCode === appCode).map((r: Fact) => ({ code: r.roleCode, name: r.roleName, description: r.description, suggestedPermissions: old.appRolePermissions.filter((p: Fact) => p.roleCode === r.roleCode).map((p: Fact) => `${p.appCode}:${p.resourceCode}:${p.action}`) })) } }
  })
  const current: Fact = { ...old, appRoleScopes: [], roleAppRoleMaps: [], systemAppRoleMaps: [], roles: [], rolePermissions: [], roleScopes: [], baselinePermissions: [], subjectRoleScopes: [], applications: [] }
  current.appRolePermissions = ['altoc', 'finance', 'people'].flatMap((app) => {
    const manifest = JSON.parse(readFileSync(new URL(`../../${app}/app.manifest.json`, import.meta.url), 'utf8'))
    return manifest.recommendedRoles.flatMap((role: Fact) => role.suggestedPermissions.map((permission: string) => ({ roleCode: role.code, permission })))
  })
  const projected = projectEnvironmentReleaseFacts(current, selection(historical, old))
  for (const field of ['manifestResources', 'manifestActions', 'appRoles', 'appRolePermissions']) {
    assert.deepEqual(diffEnvironmentPolicy({ [field]: old[field] }, { [field]: projected[field] }), [], field)
  }
  assert.equal(projected.appRolePermissions.filter((p: Fact) => p.roleCode === 'people:admin' && p.action === 'approve').length, 4)
  assert.equal(fixture.baseline.revision, 39)
})
