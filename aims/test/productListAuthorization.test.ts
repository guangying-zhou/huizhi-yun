import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileFoundationProductScope, evaluateFoundationProductAuthorization, type FoundationScopedAuthorizationGrant } from '../../foundation/server/utils/scopeEvaluator.ts'
import { productAuthorizationObject } from '../server/utils/productAuthorizationCore.ts'

const required = { appCode: 'aims', resourceCode: 'products', action: 'view' }
const permission = [{ ...required }]
test('compiled list decisions equal detail decisions across explicit products and live relationships', () => {
  const grants: FoundationScopedAuthorizationGrant[] = [
    { grantId: 'member', permissions: permission, scopes: [{ dimension: 'product', predicate: 'member' }] },
    { grantId: 'specific', permissions: permission, scopes: [{ dimension: 'product', predicate: 'code', value: 'P-A' }] },
    { grantId: 'constrained', permissions: [{ ...required, action: 'admin' }], defaultScopes: [{ dimension: 'product', predicate: 'manager' }], assignmentScopes: [{ dimension: 'product', predicate: 'code', value: 'P-B' }] }
  ]
  const projection = compileFoundationProductScope({ grants, required }, 'u1')!
  for (const productCode of ['P-A', 'P-B', 'P-C', 'p-a']) {
    for (let state = 0; state < 3; state++) {
      const object = productAuthorizationObject({ actor_uid: 'u1', product_code: productCode, status: 'active', revision: 1, is_member: state > 0, is_manager: state === 2 }, productCode, 'u1')!
      const allowed = evaluateFoundationProductAuthorization({ grants, required, object }).allowed
      const mask = projection.overrides.find(row => row.product_code === productCode)?.mask ?? projection.default_mask
      assert.equal((mask & (1 << state)) !== 0, allowed, `${productCode}/${state}`)
    }
  }
  assert.equal(projection.default_mask, 6)
  assert.deepEqual(projection.overrides, [{ product_code: 'P-A', mask: 7 }])
})
test('product list cannot combine permission from one grant with scope from another or use unrelated empty dimensions', () => {
  const grants: FoundationScopedAuthorizationGrant[] = [
    { grantId: 'wrong-action', permissions: [{ ...required, action: 'onboard' }], scopes: [{ dimension: 'tenant', predicate: 'global' }] },
    { grantId: 'scoped', permissions: permission, scopes: [{ dimension: 'product', predicate: 'manager', value: 'P-A' }] },
    { grantId: 'department', permissions: permission, scopes: [{ dimension: 'department', predicate: 'self' }] }
  ]
  assert.deepEqual(compileFoundationProductScope({ grants, required }, 'u1'), { default_mask: 0, overrides: [{ product_code: 'P-A', mask: 4 }] })
  assert.deepEqual(compileFoundationProductScope({ grants: [], required }, 'u1'), { default_mask: 0, overrides: [] })
  const global = [{ grantId: 'custom', permissions: permission, scopes: [{ dimension: 'tenant', predicate: 'global' }] }]
  assert.deepEqual(compileFoundationProductScope({ grants: global, required }, 'u1'), { default_mask: 7, overrides: [] })
})

test('unrelated grants do not consume the bounded list projection and oversized relevant scope fails explicitly', () => {
  const scopes = Array.from({ length: 513 }, (_, n) => ({ dimension: 'product', predicate: 'code', value: `P-${n}` }))
  const grant = { grantId: 'large', permissions: [{ ...required, action: 'onboard' }], scopes }
  assert.deepEqual(compileFoundationProductScope({ grants: [grant], required }, 'u1'), { default_mask: 0, overrides: [] })
  assert.equal(compileFoundationProductScope({ grants: [{ ...grant, permissions: permission }], required }, 'u1'), null)
})
