import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productGlobalOnboardDecision } from '../server/utils/productGlobalAuthorizationCore.ts'
import type { FoundationScopedAuthorizationGrant } from '../../foundation/server/utils/scopeEvaluator.ts'

const grant: FoundationScopedAuthorizationGrant = {
  grantId: 'custom-enterprise-role',
  permissions: [{ appCode: 'aims', resourceCode: 'products', action: 'onboard' }],
  assignmentScopes: [{ dimension: 'tenant', predicate: 'global' }]
}

test('onboarding accepts explicit global onboard grants among merged roles', () => {
  assert.equal(productGlobalOnboardDecision([grant]).allowed, true)
  assert.equal(productGlobalOnboardDecision([{ ...grant, grantId: 'unrelated', permissions: [] }, grant]).allowed, true)
})

test('onboarding cannot stitch permissions and scope from different grants', () => {
  const manager = { ...grant, assignmentScopes: [{ dimension: 'product', predicate: 'manager' }] }
  assert.equal(productGlobalOnboardDecision([manager, { ...grant, permissions: [] }]).allowed, false)
  assert.equal(productGlobalOnboardDecision([{ ...grant, assignmentScopes: [] }]).allowed, false)
  assert.equal(productGlobalOnboardDecision([{ ...grant, defaultScopes: [{ dimension: 'product', predicate: 'code', value: 'P-1' }] }]).allowed, false)
  for (const action of ['admin', 'edit', 'view']) {
    assert.equal(productGlobalOnboardDecision([{ ...grant, permissions: [{ appCode: 'aims', resourceCode: 'products', action }] }]).allowed, false)
  }
  assert.equal(productGlobalOnboardDecision([]).allowed, false)
})
