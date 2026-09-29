import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { composeManifest, digest, buildReleaseManifest, canonicalGeneration, catalogHasStablePermission, releaseSourcePaths, releaseBuildFiles } from '../scripts/manifest-artifacts.mjs'
const source = () => ['aims', 'assets', 'codocs'].map(app => JSON.parse(readFileSync(new URL(`../../${app}/app.manifest.json`, import.meta.url), 'utf8')))
test('composition preserves original module namespaces and role contracts', () => {
  const inputs = source(), out = composeManifest(inputs)
  assert.deepEqual(out.resources, [])
  assert.deepEqual(out.recommendedRoles, [])
  assert.equal(out.composition.permissionCatalog.resources.length, inputs.reduce((n,m) => n+m.resources.length,0))
  assert.deepEqual(out.composition.permissionCatalog.permissionCodes, out.composition.permissionCatalog.resources.flatMap(resource => resource.actions.map(action => `${resource.appCode}:${resource.code}:${action}`)).sort())
  assert.deepEqual(out.composition.permissionCatalog.roles.map(role => role.code), inputs.flatMap(input => input.recommendedRoles.map(role => role.code)).sort())
  assert.ok(out.composition.permissionCatalog.modules.every(module => !Object.hasOwn(module, 'recommendedRoles')))
  for (const module of out.composition.modules) assert.deepEqual(module.manifest, inputs.find(input => input.appCode === module.appCode))
  assert.equal(out.composition.permissionCatalogHash, digest(out.composition.permissionCatalog))
})
test('committed Host manifest matches the module manifests it composes', () => {
  // A module permission added without regenerating would pin a stale catalog
  // into every release manifest; regenerate with scripts/generate-manifest.mjs.
  const committed = readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')
  assert.equal(committed, JSON.stringify(composeManifest(source()), null, 2) + '\n')
})
test('duplicate resources, actions, roles and undefined role permissions fail closed', () => {
  let values = source(); values[0].resources.push(values[0].resources[0]); assert.throws(() => composeManifest(values), /Duplicate resource/)
  values = source(); values[0].resources[0].actions.push(values[0].resources[0].actions[0]); assert.throws(() => composeManifest(values), /Duplicate action/)
  values = source(); values[0].recommendedRoles[0].suggestedPermissions.push('assets:products:view'); assert.throws(() => composeManifest(values), /Undefined role/)
  values = source(); values[0].recommendedRoles.push(structuredClone(values[0].recommendedRoles[0])); assert.throws(() => composeManifest(values), /Duplicate role/)
  values = source(); values[0].recommendedRoles[0].suggestedPermissions.push(values[0].recommendedRoles[0].suggestedPermissions[0]); assert.throws(() => composeManifest(values), /Duplicate role permission/)
})
test('catalog validates stable permissions without reserving tenant custom role codes', () => {
  const manifest = composeManifest(source())
  const catalog = manifest.composition.permissionCatalog
  const tenantCustomRole = { code: 'tenant:custom-assets-auditor', suggestedPermissions: ['assets:asset_items:view'] }
  assert.equal(catalog.roles.some(role => role.code === tenantCustomRole.code), false)
  assert.equal(catalogHasStablePermission(catalog, tenantCustomRole.suggestedPermissions[0]), true)
  assert.equal(catalogHasStablePermission(catalog, 'assets:asset_items:destroy'), false)
  assert.deepEqual(manifest.recommendedRoles, [])
})
test('release rejects missing real build inputs and catalog tampering', () => {
  const manifest = composeManifest(source())
  assert.throws(() => buildReleaseManifest({}, manifest), /hostTag/)
  const input = { hostTag: 'enterprise/v0.1.0', sources: Object.fromEntries(releaseSourcePaths.map(app => [app,{commit:'a'.repeat(40),tree:'b'.repeat(40)}])), buildFiles:Object.fromEntries(releaseBuildFiles.map(file=>[file,{blob:'c'.repeat(40)}])),runtime:{version:'0.3.1',artifactSha256:'a'.repeat(64)},schema:{version:'1',manifestSha256:'b'.repeat(64)},paths:{registryVersion:'1',registrySha256:'c'.repeat(64),generation:1},tasks:{ownershipGeneration:1},builtAt:'2026-09-13T00:00:00Z' }
  assert.equal(buildReleaseManifest(input,manifest).permissionCatalogHash,manifest.composition.permissionCatalogHash)
  assert.equal(buildReleaseManifest(input,manifest).paths.generation, '1')
  const fullRange = buildReleaseManifest({ ...input, paths: { ...input.paths, generation: '18446744073709551615' }, tasks: { ownershipGeneration: '9007199254740993' } }, manifest)
  assert.equal(JSON.parse(JSON.stringify(fullRange)).paths.generation, '18446744073709551615')
  assert.equal(fullRange.tasks.ownershipGeneration, '9007199254740993')
  assert.throws(() => buildReleaseManifest({...input,runtime:{}},manifest), /runtime version/)
  assert.throws(() => buildReleaseManifest({ ...input, sources: { ...input.sources, foundation: undefined } }, manifest), /foundation commit/)
  assert.throws(() => buildReleaseManifest({ ...input, sources: { ...input.sources, altoc: undefined } }, manifest), /altoc commit/)
  for (const path of ['console', 'deploy/cloudflare/tenant-gateway']) {
    assert.ok(releaseSourcePaths.includes(path))
    assert.throws(() => buildReleaseManifest({ ...input, sources: { ...input.sources, [path]: undefined } }, manifest), /commit/)
  }
  for (const path of ['deploy/test-env/enterprise-host-routes.mjs', 'deploy/test-env/enterprise-topology.mjs']) {
    assert.ok(releaseBuildFiles.includes(path))
    assert.throws(() => buildReleaseManifest({ ...input, buildFiles: { ...input.buildFiles, [path]: undefined } }, manifest), /Git blob/)
  }
  assert.throws(() => buildReleaseManifest({ ...input, buildFiles: {} }, manifest), /Git blob/)
  manifest.composition.permissionCatalog.roles.pop()
  assert.throws(() => buildReleaseManifest(input,manifest), /hash mismatch/)
})

test('generation normalization rejects lossy numbers and noncanonical strings', () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '01', '+1', ' 1', '1.0', '18446744073709551616', null]) {
    assert.throws(() => canonicalGeneration(value))
  }
  assert.equal(canonicalGeneration(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER))
})

test('Altoc composition preserves established compound actions without accepting empty or wildcard segments', () => {
  const altoc = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  const result = composeManifest([...source(), altoc])
  assert.deepEqual(result.composition.modules.find(module => module.appCode === 'altoc').manifest, altoc)
  const contract = result.composition.permissionCatalog.resources.find(resource => resource.appCode === 'altoc' && resource.code === 'contract')
  assert.ok(contract.actions.includes('finance-summary:sync'))
  assert.ok(contract.actions.includes('activate-delivery'))
  for (const action of ['finance-summary::sync', ':sync', 'sync:', '*', 'finance-summary:*']) {
    const invalid = structuredClone(altoc)
    invalid.resources.find(resource => resource.code === 'contract').actions.push(action)
    assert.throws(() => composeManifest([...source(), invalid]), /invalid action/)
  }
})
