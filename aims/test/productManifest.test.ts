import { test } from 'node:test'
import assert from 'node:assert/strict'
import manifest from '../app.manifest.json' with { type: 'json' }
import { manifestResources, productManifestResources, appManifest, matchRouteRule, routeRuleRequirements } from '../app/config/permissions.ts'

test('product permission projection uses manifest actions and every role permission resolves', () => {
  assert.ok(productManifestResources.some(resource => resource.code === 'product_documents'))
  assert.equal(new Set(manifest.resources.map(resource => resource.code)).size, manifest.resources.length)
  for (const resource of [...productManifestResources, manifest.resources.find(resource => resource.code === 'requirements')!]) {
    assert.deepEqual(manifestResources.find(item => item.code === resource.code)?.supportedActions, resource.actions)
  }
  assert.equal(appManifest.recommendedRoles, manifest.recommendedRoles)
  for (const role of manifest.recommendedRoles) {
    for (const permission of role.suggestedPermissions) {
      const [app, code, action] = permission.split(':')
      assert.equal(app, 'aims')
      assert.ok(manifest.resources.find(resource => resource.code === code)?.actions.includes(action!), permission)
    }
  }
})

test('product role templates separate publication, acceptance, contribution and global onboarding', () => {
  const permissions = (code: string) => manifest.recommendedRoles.find(role => role.code === `aims:${code}`)!.suggestedPermissions
  assert.ok(permissions('product_manager').includes('aims:product_versions:accept'))
  assert.ok(!permissions('product_manager').includes('aims:product_versions:publish'))
  assert.ok(permissions('product_publisher').includes('aims:product_versions:publish'))
  assert.ok(!permissions('product_publisher').includes('aims:product_versions:accept'))
  assert.ok(!permissions('product_contributor').includes('aims:product_priorities:prioritize'))
  for (const role of manifest.recommendedRoles) {
    assert.equal(role.suggestedPermissions.includes('aims:products:onboard'), role.code === 'aims:product_director', 'only the director template includes explicit onboarding')
  }
  for (const scope of ['product:code', 'product:member', 'product:manager']) assert.ok(manifest.supportedScopes.includes(scope))
})

test('onboard-only setup entry does not require view or grant access to product records', () => {
  assert.deepEqual(routeRuleRequirements(matchRouteRule('/product-setup')!), [{ resource: 'products', action: 'onboard' }])
  for (const path of ['/products', '/products/P-001']) {
    assert.deepEqual(routeRuleRequirements(matchRouteRule(path)!), [{ resource: 'products', action: 'view' }])
  }
})


test('product document relation permissions do not grant Codocs ACL', () => {
  assert.deepEqual(manifest.resources.find(resource => resource.code === 'product_documents')?.actions, ['view', 'edit'])
  for (const role of manifest.recommendedRoles.filter(role => role.code.startsWith('aims:product_'))) {
    assert.equal(role.suggestedPermissions.includes('aims:product_documents:edit'), ['aims:product_manager', 'aims:product_director'].includes(role.code))
    assert.ok(role.suggestedPermissions.every(permission => !permission.startsWith('codocs:')))
  }
})

test('product director governs the portfolio without acceptance, publication or permanent deletion', () => {
  const role = manifest.recommendedRoles.find(role => role.code === 'aims:product_director')!
  assert.ok(role.description.includes('tenant:global'))
  for (const permission of ['products:onboard', 'products:admin', 'products:archive', 'products:restore', 'product_objectives:activate', 'product_priorities:prioritize', 'product_roadmaps:edit', 'product_versions:edit']) {
    assert.ok(role.suggestedPermissions.includes(`aims:${permission}`))
  }
  for (const permission of role.suggestedPermissions) {
    assert.ok(!permission.endsWith(':delete'))
    assert.ok(!['aims:product_versions:accept', 'aims:product_versions:publish', 'aims:product_versions:reopen'].includes(permission))
    assert.ok(!permission.endsWith(':authorization-object'))
  }
})
