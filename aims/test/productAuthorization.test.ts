import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productAuthorizationObject, type ProductAuthorizationFacts } from '../server/utils/productAuthorizationCore.ts'
import { foundationScopeSetMatches } from '../../foundation/server/utils/scopeEvaluator.ts'

const facts: ProductAuthorizationFacts = {
  product_code: 'P-A', actor_uid: 'u1', status: 'active', revision: 1, is_member: true, is_manager: true
}

test('runtime relationship facts map to the same Foundation product predicates', () => {
  const object = productAuthorizationObject(facts, 'P-A', 'u1')!
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'manager', value: 'P-A' }], object), true)
  const revoked = productAuthorizationObject({ ...facts, is_manager: false, is_member: false }, 'P-A', 'u1')!
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'member' }], revoked), false)
  assert.equal(foundationScopeSetMatches([{ dimension: 'product', predicate: 'manager' }], revoked), false)
})

test('product facts reject another subject, another product, malformed types and inconsistent manager relation', () => {
  assert.equal(productAuthorizationObject(facts, 'P-A', 'u2'), null)
  assert.equal(productAuthorizationObject(facts, 'p-a', 'u1'), null)
  for (const patch of [
    { is_member: 'true' }, { is_manager: 1 }, { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { is_member: false }, { status: 'deleted' }
  ]) {
    assert.equal(productAuthorizationObject({ ...facts, ...patch } as ProductAuthorizationFacts, 'P-A', 'u1'), null)
  }
})
